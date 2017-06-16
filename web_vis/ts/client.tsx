import * as React from "react";
import * as ReactDOM from "react-dom";
import * as mobx from "mobx";
mobx.useStrict(true);
import { observer } from "mobx-react";
import * as util from "./util";
import DevTools from "mobx-react-devtools";
import * as s from "./socket";
import * as LZString from "lz-string";
import { autobind } from "core-decorators";
import * as B from "@blueprintjs/core";
import * as Data from "./Data";
import * as v from "./Visualizer";
import { Feature, NumFeature, NumFeatureSVector, FeatureID, ConversationID } from "./features";
import { AudioPlayer, PlaybackPosition, AudioRecorder, microphoneFeature, RegionSelector } from "./Audio";
import * as queryString from "query-string";
import * as x from "./RpcWebWorker";
x;
export const globalConfig = mobx.observable({
    maxColor: "#3232C8",
    rmsColor: "#6464DC",
    leftBarSize: 200,
    zoomFactor: 1.2,
    emptyVisHeight: 50,
    defaultConversation: "sw2807",
    minRenderDelayMS: 10,
    socketDebug: false,
    followingPlaybackRenderWidthFactor: 1.2
});
export class Styles {
    @mobx.computed static get leftBarCSS() {
        return { flexBasis: "content", flexGrow: 0, flexShrink: 0, width: globalConfig.leftBarSize + "px", border: "1px solid", marginRight: "5px" };
    }
    static absoluteTopRight = { position: "absolute", top: 0, right: 0 };
    static absoluteBottomRight = { position: "absolute", bottom: 0, right: 0 };
    static absoluteTopLeft = { position: "absolute", top: 0, left: 0 };
    static absoluteBottomLeft = { position: "absolute", bottom: 0, left: 0 };
}

interface Zoom {
    left: number; right: number;
}
export interface SingleUIState {
    uuid: number;
    visualizer: v.VisualizerChoice;
    feature: FeatureID;
    config: v.VisualizerConfig;
    currentRange: { min: number, max: number } | null;
}
export interface UIState {
    uuid: number;
    height: number | "auto";
    features: SingleUIState[];
}
let uuid = 0;

export function isNumFeature(f: Feature): f is NumFeature {
    return f.typ === "FeatureType.SVector" || f.typ === "FeatureType.FMatrix";
}
export const loadingSpan = <span>Loading...</span>;

class OptimizedFeaturesTree {
    getFeaturesTree(parentPath: string, category: s.CategoryTreeElement): B.ITreeNode {
        if (!category) return { id: "unused", label: "unused", childNodes: [] };

        if (typeof category === "string") {
            return {
                id: parentPath + "/" + category, label: category
            };
        }
        const path = parentPath + "/" + category.name;
        let children = category.children.map(c => this.getFeaturesTree(path, c));
        return {
            id: path + "@",
            label: category.name,
            get childNodes(this: B.ITreeNode) {
                if (!this.isExpanded) return [];
                else return children;
            }
        };
    }
}


@observer
class ConversationSelector extends React.Component<{ gui: GUI }, {}> {
    @autobind @mobx.action
    setConversation(e: React.SyntheticEvent<HTMLInputElement>) { this.props.gui.conversationSelectorText = e.currentTarget.value; }
    async randomConversation(t?: string) {
        const conversation = await this.props.gui.randomConversation(t) as any as string;
        this.props.gui.loadConversation(conversation);
    }
    render() {
        const convos = this.props.gui.getConversations().data;
        const allconvos = convos && Object.keys(convos).map(k => convos[k]).reduce(util.mergeArray);
        return (<div style={{ display: "inline-block" }}>
            <input list="conversations" value={this.props.gui.conversationSelectorText} onChange={this.setConversation} />
            {allconvos && <datalist id="conversations">{allconvos.map(c => <option key={c as any} value={c as any} />)}</datalist>}
            <button onClick={c => this.props.gui.loadConversation(this.props.gui.conversationSelectorText)}>Load</button>
            <button onClick={() => this.randomConversation()}>Random</button>
            {convos && Object.keys(convos).map(name =>
                <button key={name} onClick={() => this.randomConversation(name)}>Random {name}</button>
            )}
        </div>);
    }
}

function getNNOutput(channel: string, version: string, epoch: string): any {
    return {
        uis: [
            { "features": [{ "feature": `/${channel}/extracted/adc`, "visualizer": "Waveform", "config": "givenRange", "currentRange": { "min": -32768, "max": 32768 } }], "height": "auto" },
            { "features": [{ "feature": `/${channel}/transcript/text`, "visualizer": "Text", "config": "normalizeLocal", "currentRange": null }], "height": "auto" },
            { "features": [{ "feature": `/${channel}/NN outputs/${version}/${epoch}`, "visualizer": "Waveform", "config": "normalizeLocal", "currentRange": { "min": 0.169875830411911, "max": 0.8434500098228455 } }], "height": "auto" },
            {
                "features": [{ "feature": `/${channel}/NN outputs/${version}/${epoch}.smooth`, "visualizer": "Waveform", "config": "normalizeLocal", "currentRange": { "min": 0.2547765076160431, "max": 0.7286926507949829 }, "uuid": 26 },
                { "feature": `/${channel}/NN outputs/${version}/${epoch}.smooth.thres`, "uuid": 31, "visualizer": "Highlights", "config": "normalizeLocal", "currentRange": null }], "height": 85, "uuid": 25
            },
            { "features": [{ "feature": `/${channel}/NN outputs/${version}/${epoch}.smooth.bc`, "visualizer": "Waveform", "config": "normalizeLocal", "currentRange": { "min": -32768, "max": 32768 } }], "height": "auto" },
            { "features": [{ "feature": `/${channel}/extracted/pitch`, "visualizer": "Waveform", "config": "normalizeLocal", "currentRange": { "min": -1, "max": 1 } }], "height": "auto" },
            { "features": [{ "feature": `/${channel}/extracted/power`, "visualizer": "Waveform", "config": "normalizeLocal", "currentRange": { "min": -1, "max": 1 } }], "height": "auto" }]
    };
}
const examples: { [name: string]: string | GUI | ((gui: GUI) => (string | GUI)) } = {
    "Microphone Input (full)": "N4IgDgNghgngRlAxgawAoHsDOBLALt9AOxAC4AGAOjOoCYaB2MgTgDYAONgRhrYGYAWAKz8aAGhAAzdBAjoA7qmjwkyUrgBOAVwCm4xEQBu29Zij4ipEJjk8y9EOM3ZMpANqhNTgCak64idpmmuraLiTukoG4wdqWAPQAttiI6uhgABZE2nHaAB4aSLjaXnFQXogOIJ7YPiQ0vOIGzppQENgAXsaWAOpQRlLqCZX6hBLYAOaWhOiDrR3aADLoiK3DwSGEuABKUITjsSSgScQkhJoy4glQuaRnMgC+9wC64unaE+m4llCauOgg91EHm8vn4-iiMTCEQCQRC8SSKTSmUI2TyBUQRRK6igcgA+mB5F1HCC6oJGs05p11D0+toBkM9EQxpMSCBprM2p0lisIGt1Bttrt9qQjtgTmRLtdSGRHi8QG8Pl9WT8-gCgVUSTQWODYaE3KAYdE4azEslUhksjl8tiMcU4mA8Ih0pVqrUGOTMC1OV1Wb1+jMGSARsypgHKYtlqs9OttJsdnsDqLxZKbuRZa93uNPt9fv9AcCar42DqjXrwgaIcaQKbERaUVb0Zi4hIJAYXZqmB6vfNqb7afThkyJqGOfNuVGgzG40LEyBjtKU9L0-LM9mSNx6PmNYWSLwJZFdVCK7r4WakZa0Tam4RiMSd7xOF3w72QH66QHB6Nh6z2VdvePeWjflY0FBMRTnMUFznKU02eDNFRzVUt1dUheDEA9SyPDCYlPWtkVRa1CjtG8KEwBJ0HQXBnTvWpeAaEAmk9Z8aX9QZPxDH8w3-SNAMnYDpzAw4IOTaDUxlOCVwQ5VczVAtaLBbCQiww0cJNBFzXwhsr2IwhSPIyj0goOAKho1CyQYilvRfN8B0ZL8WTZLixx4vkBXjYUhPnchF1guUFSzJUQBVPM5XaCihiEiA6SVfd1CkygaE4ND+F4Jh6E4QQaEETgWAETdxD+XBWgAFWwBJtAAZW0EYvDCFgZSAA",
    "Microphone Input (fast)": () => {
        document.body.style.maxWidth = "700px";
        return "N4IgDgNghgngRlAxgawAoHsDOBLALt9AOxAC4AGAGhADN0IJ0B3VaeJZU3AJwFcBTKoiIA3Pl0xR8RUiEyMATAA4yAdhBUe2TKQDaoHpoAmpAGxVqfSTy59tJPTUu5rfGQHoAttkRd0YABZEfG58AB7cSLh8hm5QhojqIAbYxiQqVMJaPFAQ2ABeYjIA6lCitFweiUKE1NgA5jKE6BU5+XwAMuiIOVXWNoS4AEpQhHWuJKBexCQAtGQAdGTyACwAnCqry2QmqyYqKgCsqwCMAMzyVB5QoaQLS8vH8qvbSidk28sqAL5fALpU-j49X8uBkUB4uHQIC+FH0RlIinMThcdgcFisNncXh8fkChGCYQiiCiMUIhHmmA86HQuH8iWSqVWGSyrQKXGKpT45UqgiItQaJBATRauQKnW6EF6XH6QxGY1Ik2w00oICuN3I80+Kge22OyzWZAOZGepx+-xAgOBoMF4Mh0NhSXhJGOKvRzhsqNAbpcWO8vgCQRC4S4kWibjJFKpNP88zgCQ0TuOx2ZmGyosKgpKZWaPJA1X5jRzrI6XR6gj6fAGw1G40Vysu11uZoBQLqILBEKhfyoeWplQmIAgXOtKq4VtuiyO6xU8gOBxMii2SgOpwOMJAkNwOQAKtgPHwAMp8aqGOwmMhfIA";
    },
    "sample NN output for channel A": getNNOutput("A", "v050-finunified-65-ge1015c2-dirty:lstm-best-features-raw_power,pitch,ffv_live", "best"),
};

@observer
class NNExample extends React.Component<{ gui: GUI }, {}> {
    @mobx.observable
    channel = "A";
    @mobx.observable
    version = "latest";
    @mobx.observable
    epoch = "best";

    render() {
        if (!this.props.gui.conversation) return <span />;
        const fes = this.props.gui.getFeatures().data;
        let c3 = null, c4 = null, c5;
        if (fes) {
            const c1 = fes.categories
                .find(c => typeof c !== "string" && c.name === "A")! as { name: string, children: s.CategoryTreeElement[] };
            const c2 = c1.children.find(c => typeof c !== "string" && c.name === "NN outputs")! as { name: string, children: s.CategoryTreeElement[] };
            if (c2) {
                c3 = c2.children.map(x => typeof x !== "string" ? x.name : x);
                c4 = c2.children.find(x => typeof x !== "string" && x.name === this.version)! as { name: string, children: s.CategoryTreeElement[] };
                if (c4) c5 = c4.children.map(x => typeof x !== "string" ? x.name : x)
            }

        }
        return (
            <B.Popover popoverClassName="withpadding" position={B.Position.BOTTOM}
                content={<div>
                    <label className="pt-label pt-inline">Channel
                        <div className="pt-select">
                            <select value={this.channel} onChange={mobx.action("set channel", (e: React.SyntheticEvent<HTMLSelectElement>) => this.channel = e.currentTarget.value)}>
                                <option value="A">A</option><option value="B">B</option>
                            </select>
                        </div>
                    </label>
                    <label className="pt-label pt-inline">NN version
                        <div className="pt-select">
                            <select value={this.version} onChange={mobx.action("set nn version", (e: React.SyntheticEvent<HTMLSelectElement>) => this.version = e.currentTarget.value)}>
                                {c3 && c3.map(version =>
                                    <option key={version} value={version}>{version}</option>)
                                }
                            </select>
                        </div>
                    </label>
                    <label className="pt-label pt-inline">epoch
                        <div className="pt-select">
                            <select value={this.epoch} onChange={mobx.action("set nn epoch", (e: React.SyntheticEvent<HTMLSelectElement>) => this.epoch = e.currentTarget.value)}>
                                {c5 && c5.map(epoch =>
                                    <option key={epoch} value={epoch}>{epoch}</option>)}
                            </select>
                        </div>
                    </label>

                    <label className="pt-label pt-inline"><button className="pt-button pt-intent-danger pt-icon-remove pt-popover-dismiss" onClick={e =>
                        this.props.gui.deserialize(getNNOutput(this.channel, this.version, this.epoch))}>Load</button></label>
                </div>
                }><button>NN output</button></B.Popover>
        );
    }
}

@observer
class MaybeAudioPlayer extends React.Component<{ gui: GUI }, {}> {
    render() {
        const gui = this.props.gui;
        if (gui.loadingState !== 1) return <span />;
        const visibleFeatures = new Set(gui.uis.map(ui => ui.features).reduce((a, b) => (a.push(...b), a), []));
        const visibleAudioFeatures = [...visibleFeatures]
            .map(f => gui.getFeature(f.feature).data)
            .filter(f => f && f.typ === "FeatureType.SVector" &&
                (this.props.gui.playthrough || !this.props.gui.audioRecorder || !this.props.gui.audioRecorder.recording || f.name !== microphoneFeature.id)
            ) as NumFeatureSVector[];
        if (visibleAudioFeatures.length > 0)
            return <AudioPlayer features={visibleAudioFeatures} gui={gui} ref={gui.setAudioPlayer} />;
        else return <span />;
    }
}
@observer
class MaybeAudioRecorder extends React.Component<{ gui: GUI }, {}> {
    render() {
        const gui = this.props.gui;
        if (gui.loadingState !== 1) return <span />;
        const visibleFeatures = [...new Set(gui.uis.map(ui => ui.features).reduce((a, b) => (a.push(...b), a), []))];
        const visible = visibleFeatures.some(f => f.feature === microphoneFeature.id);
        if (visible)
            return <AudioRecorder gui={gui} ref={gui.setAudioRecorder} />;
        else return <span />;
    }
}
@observer
export class GUI extends React.Component<{}, {}> {

    @mobx.observable windowWidth = window.innerWidth;
    @mobx.observable playbackPosition = 0;
    @mobx.observable selectionStart = NaN;
    @mobx.observable selectionEnd = NaN;
    @mobx.observable followPlayback = false;
    @mobx.observable followCenter = 0.8;
    @mobx.observable conversation: ConversationID;
    @mobx.observable conversationSelectorText = "";
    @mobx.observable uis = [] as UIState[];
    @mobx.observable playthrough = false;
    @mobx.observable zoom = {
        left: 0, right: 1
    };
    @mobx.observable _totalTimeSeconds = NaN;
    get totalTimeSeconds() {
        return this._totalTimeSeconds;
    }
    set totalTimeSeconds(v) {
        if (v === null) throw new Error("NO")
        this._totalTimeSeconds = v;
    }
    audioPlayer: AudioPlayer | null = null; setAudioPlayer = (a: AudioPlayer) => this.audioPlayer = a;
    @mobx.observable audioRecorder: AudioRecorder | null = null;
    setAudioRecorder = mobx.action("setAudioRecorder", (a: AudioRecorder) => this.audioRecorder = a);
    uisDiv: HTMLDivElement; setUisDiv = (e: HTMLDivElement) => this.uisDiv = e;
    @mobx.observable widthCalcDiv: HTMLDivElement; setWidthCalcDiv = mobx.action("setWidthCalcDiv", (e: HTMLDivElement) => this.widthCalcDiv = e);
    socketManager: s.SocketManager;
    stateAfterLoading = null as any | null;
    @mobx.observable
    loadingState = 1;
    loadedFeatures = new Set<NumFeature>();
    @mobx.computed get categoryTree() {
        const data = this.getFeatures().data;
        if (!data) return [];
        else {
            const ft = new OptimizedFeaturesTree();
            return data.categories.map(c => ft.getFeaturesTree("", c));
        }
    }
    serialize() {
        return LZString.compressToEncodedURIComponent(JSON.stringify(mobx.toJS({
            playbackPosition: this.playbackPosition,
            followPlayback: this.followPlayback,
            conversation: this.conversation,
            uis: this.uis, // TODO: remove uuids
            zoom: this.zoom,
            totalTimeSeconds: this.totalTimeSeconds
        })));
    }
    @mobx.action
    deserialize(data: string | GUI | ((gui: GUI) => (string | GUI))) {
        if (typeof data === "function") data = data(this);
        if (this.audioPlayer) this.audioPlayer.playing = false;
        if (this.loadingState !== 1) {
            console.error("can't load while loading");
            return;
        }
        let obj;
        if (typeof data === "string") obj = JSON.parse(LZString.decompressFromEncodedURIComponent(data));
        else obj = data;
        if (obj.conversation && this.conversation !== obj.conversation) {
            this.loadConversation(obj.conversation, obj);
        } else {
            this.applyState(obj);
        }
    }
    @mobx.action
    applyState(targetState: GUI) {
        console.log("applying state", targetState);
        if (targetState.uis) targetState.uis.forEach(ui => { ui.uuid = uuid++; ui.features.forEach(ui => ui.uuid = uuid++); });
        Object.assign(this, targetState);
    }
    @mobx.computed
    get left() {
        this.windowWidth;
        return this.widthCalcDiv ? this.widthCalcDiv.getBoundingClientRect().left : 0;
    }
    @mobx.computed
    get width() {
        this.windowWidth;
        return this.widthCalcDiv ? this.widthCalcDiv.clientWidth : 100;
    }
    @mobx.action
    async loadConversation(conversation: string, targetState?: GUI) {
        const convID = await this.verifyConversationID(conversation);
        mobx.runInAction("resetUIs", () => {
            this.uis = [];
            this.conversation = convID;
            this.zoom.left = 0; this.zoom.right = 1;
            this.totalTimeSeconds = NaN;
            this.loadedFeatures.clear();
            this.loadingState = 0;
            this.conversationSelectorText = conversation;
        });
        const features = await this.getFeatures();
        const targetFeatures = targetState ? targetState.uis.map(ui => ui.features.map(ui => ui.feature)) : features.defaults;
        const total = targetFeatures.reduce((sum, next) => sum + next.length, 0);
        let i = 0;
        for (const featureIDs of targetFeatures) {
            const ui = this.getDefaultUIState([]);
            mobx.runInAction("addDefaultUI", () => {
                this.uis.push(ui);
            });
            for (const featureID of featureIDs) {
                const feat = await this.getFeature(featureID);
                mobx.runInAction("progressIncrement", () => {
                    ui.features.push(this.getDefaultSingleUIState(feat));
                    this.loadingState = ++i / total;
                });
            }
        }
        if (targetState) {
            this.applyState(targetState);
        }
    }
    async verifyConversationID(id: string): Promise<ConversationID> {
        const convos = await this.socketManager.getConversations();
        if (Object.keys(convos).some(name => convos[name].indexOf(id as any) >= 0)) return id as any;
        throw Error("unknown conversation " + id);
    }
    async randomConversation(category?: string): Promise<ConversationID> {
        const convos = await this.getConversations();
        let choices;
        if (!category) choices = Object.keys(convos).map(k => convos[k]).reduce(util.mergeArray);
        else choices = convos[category];
        return util.randomChoice(choices);
    }
    @mobx.action
    onWheel(event: MouseWheelEvent) {
        if (!event.ctrlKey) return;
        event.preventDefault();
        const position = util.getPositionFromPixel(event.clientX, this.left, this.width, this.zoom)!;
        const scaleChange = event.deltaY > 0 ? globalConfig.zoomFactor : 1 / globalConfig.zoomFactor;
        this.zoom = util.rescale(this.zoom, scaleChange, position);
        this.zoom.right = Math.min(this.zoom.right, 1);
        this.zoom.left = Math.max(this.zoom.left, 0);
    }
    getDefaultSingleUIState(feature: Feature): SingleUIState {
        let visualizerConfig: v.VisualizerConfig;
        if (isNumFeature(feature) && feature.range instanceof Array) {
            visualizerConfig = "givenRange";
        } else visualizerConfig = "normalizeLocal";
        return {
            feature: feature.name,
            uuid: uuid++,
            visualizer: v.getVisualizerChoices(feature)[0],
            config: visualizerConfig,
            currentRange: mobx.asStructure(null),
        };
    }
    getDefaultUIState(features: Feature[]): UIState {
        return {
            uuid: uuid++,
            features: features.map(f => this.getDefaultSingleUIState(f)),
            height: "auto"
        };
    }
    checkTotalTime(feature: Feature) {
        if (isNumFeature(feature)) {
            if (this.loadedFeatures.has(feature)) return;
            let totalTime: number = NaN;
            if (feature.typ === "FeatureType.SVector") {
                totalTime = feature.data.shape[0] / (feature.samplingRate * 1000);
            } else if (feature.typ === "FeatureType.FMatrix") {
                totalTime = feature.data.shape[0] * feature.shift / 1000;
            }
            if (!isNaN(totalTime)) {
                if (isNaN(this.totalTimeSeconds)) {
                    mobx.runInAction("setTotalTime", () => {
                        this.totalTimeSeconds = totalTime
                    });
                } else if (Math.abs((this.totalTimeSeconds - totalTime) / totalTime) > 0.001) {
                    console.error("Mismatching times, was ", this.totalTimeSeconds, "but", feature.name, "has length", totalTime, ", overwritten");
                    /*mobx.runInAction("setTotalTime", () => {
                        this.totalTimeSeconds = totalTime
                    });*/
                }
            }
        }
    }
    @autobind
    onSocketOpen() {
        if (location.hash.length > 1) {
            this.deserialize(location.hash.substr(1));
        } else {
            this.loadConversation(globalConfig.defaultConversation);
        }
    }
    @autobind
    windowResize() {
        if (this.windowWidth !== document.body.clientWidth)
            mobx.runInAction("windowWidthChange", () => this.windowWidth = document.body.clientWidth);
    }
    constructor() {
        super();
        const query = queryString.parse(location.search);
        let server = query["socket"] as string;
        if (!server) {
            if (location.host.includes("sexy")) server = `wss://${location.host}/web-vis/backend`;
            else server = `ws://${location.host.split(":")[0]}:8765`;
        }
        this.socketManager = new s.SocketManager(server);
        window.addEventListener("wheel", e => this.onWheel(e));
        window.addEventListener("resize", this.windowResize);
        // window resize is not fired when scroll bar appears. wtf.
        setInterval(this.windowResize, 200);
        window.addEventListener("hashchange", mobx.action("hashChange", e => this.deserialize(location.hash.substr(1))));
        this.socketManager.socketOpen().then(this.onSocketOpen);
    }
    getFeature(id: string | FeatureID) {
        let f: s.LulPromise<Feature>;
        if (id === microphoneFeature.id) f = new s.LulPromise(AudioRecorder.getFeature());
        else f = this.socketManager.getFeature(this.conversation, id as any as FeatureID);
        f.then(f => {
            this.checkTotalTime(f)
        });
        return f;
    }
    getFeatures() {
        return this.socketManager.getFeatures(this.conversation);
    }
    getConversations() {
        return this.socketManager.getConversations();
    }
    @mobx.action
    addUI(afterUuid: number) {
        this.uis.splice(this.uis.findIndex(ui => ui.uuid === afterUuid) + 1, 0, { uuid: uuid++, features: [], height: "auto" });
    }
    *getVisualizers() {
        for (const ui of this.uis) {
            yield <v.InfoVisualizer key={ui.uuid} uiState={ui} gui={this} />;
            yield <button key={ui.uuid + "+"} onClick={() => this.addUI(ui.uuid)}>Add Visualizer</button>;
        }
    }
    render(): JSX.Element {
        const self = this;
        const ProgressIndicator = observer(function ProgressIndicator() {
            if (self.loadingState === 1) return <span>Loading complete</span>;
            return (
                <div style={{ display: "inline-block", width: "200px" }}>
                    Loading: <B.ProgressBar intent={B.Intent.PRIMARY} value={self.loadingState} />
                </div>
            );
        });
        return (
            <div>
                <div style={{ margin: "10px" }} className="headerBar">
                    <div>
                        <ConversationSelector gui={this} />
                        <label>Follow playback:
                            <input type="checkbox" checked={this.followPlayback}
                                onChange={mobx.action("changeFollowPlayback", (e: React.SyntheticEvent<HTMLInputElement>) => this.followPlayback = e.currentTarget.checked)} />
                        </label>
                        <span>Playback position: <PlaybackPosition gui={this} /></span>
                    </div>
                    <RegionSelector gui={this} />
                    <MaybeAudioRecorder gui={this} />
                    <button onClick={() => location.hash = "#" + this.serialize()}>Serialize → URL</button>
                    <ProgressIndicator />
                    {Object.keys(examples).length > 0 && <span>Examples: {Object.keys(examples).map(k =>
                        <button key={k} onClick={e => this.deserialize(examples[k])}>{k}</button>)}</span>
                    }
                    <NNExample gui={this} />
                </div>
                <div ref={this.setUisDiv} style={{ overflowX: "hidden" }}>
                    <div style={{ display: "flex", visibility: "hidden" }}>
                        <div style={Styles.leftBarCSS} />
                        <div style={{ flexGrow: 1 }} ref={this.setWidthCalcDiv} />
                    </div>
                    {[...this.getVisualizers()]}
                </div>
                <MaybeAudioPlayer gui={this} />
                {!!localStorage.devTools && <DevTools />}
            </div>
        );
    }
}



const _gui = ReactDOM.render(<GUI />, document.getElementById("root")) as GUI;

Object.assign(window, { gui: _gui, util, globalConfig, mobx, Data });
