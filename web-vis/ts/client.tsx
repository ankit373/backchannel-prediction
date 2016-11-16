import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { autorun, computed, observable, action, extendObservable, useStrict, isObservableArray, asMap } from 'mobx';
useStrict(true);
import { observer } from 'mobx-react';
import * as Waveform from './Waveform';
import * as util from './util';
import DevTools from 'mobx-react-devtools';

export const globalConfig = {
    maxColor: "#3232C8",
    rmsColor: "#6464DC",
    leftBarSize: 100,
    zoomFactor: 1.2,
    visualizerHeight: 150,
};


export interface VisualizerProps<T> {
    gui: GUI;
    config: VisualizerConfig;
    feature: T;
    zoom: Zoom;
}
export interface Visualizer<T> {
    new (props?: VisualizerProps<T>, context?: any): React.Component<VisualizerProps<T>, {}>;
}
export type NumFeatureCommon = {
    name: string,
    samplingRate: number, // in kHz
    shift: number,
    range: [number, number] | "normalize"
};
export type NumFeatureSVector = NumFeatureCommon & {
    typ: "FeatureType.SVector",
    data: number[]
};
export type NumFeatureFMatrix = NumFeatureCommon & {
    typ: "FeatureType.FMatrix",
    data: number[][]
};
export type Utterances = {
    name: string,
    typ: "utterances",
    data: {from: number | string, to: number | string, text: string, id: string}[]
}
export type NumFeature = NumFeatureSVector | NumFeatureFMatrix;
export type Feature = NumFeature | Utterances;
export type ClientMessage = {
    type: "loadConversation",
    name: string
} | {
    type: "getConversations"
}
export type ServerMessage = {
    type: "getConversations",
    data: string[]
} | {
    type: "getFeature",
    data: Feature
}
export type VisualizerConfig  = {min: number, max: number} | "normalize";

interface UIState {
    visualizer: string;
    visualizerConfig: VisualizerConfig,
    feature: string;
}
interface Zoom {
    left: number; right: number;
}

@observer
class InfoVisualizer extends React.Component<{uiState: UIState, zoom: Zoom, gui: GUI}, {}> {
    @observable range = "[-1:1]";
    static ranges: {[name: string]: (f: NumFeature) => VisualizerConfig} = {
        "[-1:1]": (f) => ({min: -1, max: 1}),
        "[0:1]": (f) => ({min: 0, max: 1}),
        "normalize": (f) => "normalize"
    }
    /*@action
    changeRange(evt: React.FormEvent<HTMLSelectElement>) {
        this.range = evt.currentTarget.value;
        console.log(this.range);
        this.props.uiState.visualizerConfig = InfoVisualizer.ranges[this.range](features.get(this.props.uiState.feature)!);        
    }*/
    render() {
        const {uiState, zoom, gui} = this.props;
        const Visualizer = getVisualizer(uiState);
        if (!Visualizer) throw Error("Could not find visualizer " + uiState.visualizer);
        return (
            <div style={{display: "flex"}}>
                <div style={{flexBasis: "content", flexGrow:0, flexShrink: 0, width:globalConfig.leftBarSize+"px"}}>
                    {uiState.feature}
                    {/*<select value={this.range} onChange={this.changeRange.bind(this)} >
                        {Object.keys(InfoVisualizer.ranges).map(k => <option key={k} value={k}>{k}</option>)}
                    </select>*/}
                </div>
                <div style={{flexGrow: 1}}>
                    <Visualizer config={uiState.visualizerConfig} zoom={zoom} feature={features.get(uiState.feature)!} gui={gui} />
                </div>
            </div>
        );

    }
}
@observer
class TextVisualizer extends React.Component<VisualizerProps<Utterances>, {}> {
    @observable
    tooltip: number|null = null;
    @computed get playbackTooltip() {
        const data = this.props.feature.data;
        const b = util.binarySearch(0, data.length, x => +data[x].from, this.props.gui.playbackPosition * state.totalTimeSeconds);
        return b;
    }
    // @computed currentlyVisibleTh
    getElements() {
        const width = this.props.gui.width;
        return this.props.feature.data.map((utt,i) => {
            const from = +utt.from / state.totalTimeSeconds, to = +utt.to / state.totalTimeSeconds;
            let left = util.getPixelFromPosition(from, 0, width, this.props.zoom);
            let right = util.getPixelFromPosition(to, 0, width, this.props.zoom);
            if ( right < 0 || left > this.props.gui.width) return null;
            const style = {}
            let className = "utterance utterance-text";
            if(left < 0) {
                left = 0;
                Object.assign(style, {borderLeft: "none"});
                className += " leftcutoff";
            }
            if(right > width) {
                right = width;
                Object.assign(style, {borderRight: "none"});
                className += " rightcutoff";
            }
            Object.assign(style, {left:left+"px", width: (right-left - 6)+"px"});
            return <div className={className} key={utt.id} style={style}
                    onMouseEnter={action("hoverTooltip", _ => this.tooltip = i)}
                    onMouseLeave={action("hoverTooltipDisable", _ => this.tooltip = null)}>
                <span>{utt.text}</span>
            </div>;
        });
    }
    getTooltip(i: number) {
        const width = this.props.gui.width;
        const pos = this.props.gui.playbackPosition;
        const utt = this.props.feature.data[i];
        const from = +utt.from / state.totalTimeSeconds, to = +utt.to / state.totalTimeSeconds;
        let left = util.getPixelFromPosition(from, 0, width, this.props.zoom)|0;
        let right = util.getPixelFromPosition(to, 0, width, this.props.zoom)|0;
        if ( right < 0 || left > this.props.gui.width) return null;
        const style = {}
        let className = "utterance tooltip visible";
        Object.assign(style, {left:left+"px", width: (right-left - 6)+"px"});
        return <div className={className} key={utt.id} style={style}>
            <span className="content"><b/>{utt.text}</span>
        </div>;
    }
    Tooltip = observer(props => {
        return <div>
            {this.tooltip !== null && <div style={{position: "relative", height: "0px", width:"100%"}}>{this.getTooltip(this.tooltip)}</div>}
            {this.playbackTooltip !== null && <div style={{position: "relative", height: "0px", width:"100%"}}>{this.getTooltip(this.playbackTooltip)}</div>}
        </div>;
    })
    render() {
        return (
            <div>
                <div style={{overflow: "hidden", position: "relative", height: "40px", width:"100%"}}>{this.getElements()}</div>
                <this.Tooltip />
                {/*<div style={{position: "absolute", height: "40px", width:"100%"}}>{this.getElements(true)}</div>*/}
            </div>);
    }
}
@observer
class AudioPlayer extends React.Component<{features: NumFeatureSVector[], zoom: Zoom, gui: GUI}, {}> {
    playerBar: HTMLDivElement;
    disposers: (() => void)[] = [];
    audio: AudioContext;
    audioBuffers = new WeakMap<NumFeatureSVector, AudioBuffer>();
    audioSources = [] as AudioBufferSourceNode[];
    duration = 0;
    playing: boolean;
    startedAt: number;
    constructor(props: any) {
        super(props);
        this.audio = new AudioContext();
    }

    updateBar = action("updateBar", () => {
        if(this.audioSources.length === 0) return;
        this.props.gui.playbackPosition = (this.audio.currentTime - this.startedAt) / this.duration;
        this.playerBar.style.left = util.getPixelFromPosition(this.props.gui.playbackPosition, this.props.gui.left, this.props.gui.width, this.props.zoom) + "px";
        if(this.playing) requestAnimationFrame(this.updateBar);
    });
    stopPlayback() {
        while(this.audioSources.length > 0) {
            this.audioSources.pop()!.stop();
        }
    }

    onKeyUp = (event: KeyboardEvent) => {
        if(event.keyCode == 32) {
            event.preventDefault();
            if(this.audioSources.length > 0) {
                this.stopPlayback();
            } else {
                for(const feature of this.props.features) {
                    const buffer = this.audioBuffers.get(feature)!;
                    const audioSource = this.audio.createBufferSource();
                    audioSource.buffer = buffer;
                    audioSource.connect(this.audio.destination);
                    audioSource.start(0, this.props.gui.playbackPosition * buffer.duration);
                    this.startedAt = this.audio.currentTime - this.props.gui.playbackPosition * buffer.duration;
                    audioSource.addEventListener("ended", () => this.playing = false);
                    this.audioSources.push(audioSource);
                }
                this.playing = true;
                requestAnimationFrame(this.updateBar);
            }
        }
    }
    onKeyDown = (event: KeyboardEvent) => {
        if(event.keyCode == 32) {
            event.preventDefault();
        }
    }
    onClick = action("clickSetPlaybackPosition", (event: MouseEvent) => {
        event.preventDefault();
        this.stopPlayback();
        this.props.gui.playbackPosition = util.getPositionFromPixel(event.clientX, this.props.gui.left, this.props.gui.width, this.props.zoom)!;
        this.playerBar.style.left = event.clientX + "px";
    });

    componentDidMount() {
        const {gui, zoom} = this.props;
        this.disposers.push(autorun(() => this.playerBar.style.left = util.getPixelFromPosition(gui.playbackPosition, gui.left, gui.width, zoom) + "px"));
        const uisDiv = this.props.gui.uisDiv;
        uisDiv.addEventListener("click", this.onClick);
        window.addEventListener("keydown", this.onKeyDown);
        window.addEventListener("keyup", this.onKeyUp);
        this.disposers.push(() => uisDiv.removeEventListener("click", this.onClick));
        this.disposers.push(() => window.removeEventListener("keydown", this.onKeyDown));
        this.disposers.push(() => window.removeEventListener("keyup", this.onKeyUp));
        this.disposers.push(() => this.stopPlayback());
    }
    componentWillUnmount() {
        for(const disposer of this.disposers) disposer();
    }
    render() {
        for(const feature of this.props.features) {
            if(this.audioBuffers.has(feature)) continue;
            console.log("creating buffer for "+feature.name);
            const audioBuffer = this.audio.createBuffer(1, feature.data.length, feature.samplingRate * 1000);
            const arr = Float32Array.from(feature.data, v => v / 2 ** 15);
            audioBuffer.copyToChannel(arr, 0);
            this.duration = audioBuffer.duration;
            this.audioBuffers.set(feature, audioBuffer);
        }
        return (
            <div ref={p => this.playerBar = p} style={{position: "fixed", width: "2px", height: "100vh", top:0, left:-10, backgroundColor:"gray"}} />
        );
    }
}
const features = new Map<string, Feature>();
function getVisualizer(uiState: UIState): Visualizer<any> {
    const feat = features.get(uiState.feature)!;
    if(feat.typ === "FeatureType.SVector") {
        return Waveform.AudioWaveform;
    } else if (feat.typ === "FeatureType.FMatrix") {
        return Waveform.MultiWaveform;
    } else if (feat.typ === "utterances") {
        return TextVisualizer;
    } else throw Error("Can't visualize " + (feat as any).typ);
}
const state = observable({
    conversation: "sw2807",
    conversations: [] as string[],
    uis: [] as UIState[],
    zoom: {
        left: 0, right: 1
    },
    totalTimeSeconds: NaN
});

const socket = new WebSocket(`ws://${location.host.split(":")[0]}:8765`);

function sendMessage(message: ClientMessage) {
    console.log("SENDING: ", message);
    socket.send(JSON.stringify(message));
}
socket.onopen = event => {
    sendMessage({type: "getConversations"});
    loadConversation();
};

const loadConversation = action(function loadConversation() {
    state.uis = [];
    state.zoom.left = 0; state.zoom.right = 1;
    state.totalTimeSeconds = NaN;
    sendMessage({type: "loadConversation", name: state.conversation});
});
function splitIn(count: number, data: Utterances) {
    const feats: Utterances[] = [];
    for(let i = 0; i < count; i++) {
        feats[i] = {name: data.name+"."+i, typ: data.typ, data: []};
    }
    data.data.forEach((utt, i) => feats[i%count].data.push(utt));
    return feats;
}
socket.onmessage = action("onSocketMessage", (event: MessageEvent) => {
    const data: ServerMessage = JSON.parse(event.data);
    console.log("RECEIVING", data);
    switch (data.type) {
        case "getConversations": {
            state.conversations = data.data;
            break;
        }
        case "getFeature": {
            const feature = data.data;
            features.set(feature.name, feature);
            if(feature.typ === "utterances") {
                /*for(const feat of splitIn(5, data)) {
                    features.set(feat.name, feat);
                    state.uis.push({ feature: feat.name, visualizer: "TextVisualizer", visualizerConfig: "normalize"});
                }*/
                state.uis.push({ feature: feature.name, visualizer: "TextVisualizer", visualizerConfig: "normalize"});
            } else {
                let visualizerConfig: VisualizerConfig;
                if(feature.range instanceof Array) {
                    visualizerConfig = {min: feature.range[0], max: feature.range[1]};
                } else visualizerConfig = feature.range;
                let totalTime;
                if(feature.typ === "FeatureType.SVector") {
                    totalTime = feature.data.length / (feature.samplingRate * 1000);
                } else if(feature.typ === "FeatureType.FMatrix") {
                    totalTime = feature.data.length * feature.shift / 1000;
                }
                if (totalTime) {
                    if(isNaN(state.totalTimeSeconds)) state.totalTimeSeconds = totalTime;
                    else if(Math.abs((state.totalTimeSeconds - totalTime) / totalTime) > 0.001) {
                        console.error("Mismatching times, was ", state.totalTimeSeconds, "but", feature.name, "has length", totalTime);
                    }
                }
                state.uis.push({ feature: feature.name, visualizer: "Waveform", visualizerConfig });
            }
            break;
        }
        default: throw Error("unknown message "+data)
    }
});
@observer
class ConversationSelector extends React.Component<{}, {}> {
    render() {
        return (<div>
            <input list="conversations" value={state.conversation} onChange={action("editConversation", (e: React.SyntheticEvent<HTMLInputElement>) => state.conversation = e.currentTarget.value)} />
            <datalist id="conversations">
                {state.conversations.map(c => <option key={c} value={c}/>)}
            </datalist>
            <button onClick={c => loadConversation()}>Load</button>
        </div>)
    }
}
@observer
class GUI extends React.Component<{}, {}> {
    @observable widthCalcDiv: HTMLDivElement;
    @observable windowWidth = window.innerWidth;
    @observable playbackPosition = 0;
    uisDiv: HTMLDivElement;
    @computed
    get left() {
        this.windowWidth;
        return this.widthCalcDiv ? this.widthCalcDiv.getBoundingClientRect().left : 0;
    }
    @computed
    get width() {
        this.windowWidth;
        return this.widthCalcDiv ? this.widthCalcDiv.clientWidth : 100;
    }
    @action
    onWheel(event: MouseWheelEvent) {
            if (!event.ctrlKey) return;
            event.preventDefault();
            const position = util.getPositionFromPixel(event.clientX, this.left, this.width, state.zoom)!;
            const scale = 1/(state.zoom.right - state.zoom.left);
            const scaleChange = event.deltaY > 0 ? globalConfig.zoomFactor : 1/globalConfig.zoomFactor;
            const newScale = scale * scaleChange;
            state.zoom.left -= position;
            state.zoom.right -= position;
            state.zoom.left *= scaleChange; 
            state.zoom.right *= scaleChange;
            state.zoom.left += position;
            state.zoom.right += position;
            state.zoom.right = Math.min(state.zoom.right, 1);
            state.zoom.left = Math.max(state.zoom.left, 0);
    }
    constructor() {
        super();
        window.addEventListener("wheel", e => this.onWheel(e));
        window.addEventListener("resize", action("windowResize", (e: UIEvent) => this.windowWidth = window.innerWidth));
    }
    render() {
        const visibleFeatures = new Set(state.uis.map(ui => ui.feature));
        const visibleAudioFeatures = [...visibleFeatures]
            .map(f => features.get(f)!)
            .filter(f => f.typ === "FeatureType.SVector") as NumFeatureSVector[];
        let audioPlayer
        if(visibleAudioFeatures.length > 0)
            audioPlayer = <AudioPlayer features={visibleAudioFeatures} zoom={state.zoom} gui={this} />;
        return (
            <div>
                <div style={{margin: "10px"}}>
                    <ConversationSelector />
                </div>
                <div ref={div => this.uisDiv = div}>
                    <div style={{display: "flex"}}>
                        <div style={{flex: "0 0 content", width:globalConfig.leftBarSize+"px"}}></div>
                        <div style={{flexGrow: 1}} ref={action("setWidthCalcDiv", (e: any) => this.widthCalcDiv = e)} ></div>
                    </div>
                    
                    {state.uis.map((p, i) => <InfoVisualizer key={p.feature} uiState={p} zoom={state.zoom} gui={this} />)}
                </div>
                {audioPlayer}
                <DevTools />
            </div>
        );
    }
}


const gui = ReactDOM.render(<GUI />, document.getElementById("root"));
Object.assign(window, {gui, state, features, util, action});
/*window.addEventListener("wheel", event => {
    if (event.deltaY > 0) canvas.width *= 1.1;
    else canvas.width *= 0.9;
    renderWaveform(canvas, data);
});*/

