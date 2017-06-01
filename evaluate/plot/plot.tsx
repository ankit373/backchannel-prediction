import { Line } from 'react-chartjs-2';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Table, Tr, Td } from 'reactable';
import { observable, action, computed } from 'mobx';
import * as mobx from 'mobx';
import { observer, Observer } from 'mobx-react';
import 'react-select/dist/react-select.css';
import './style.less';
import * as Select from 'react-select';
import { Tab, Tabs, TabList, TabPanel } from 'react-tabs';
import * as util from './util';
import * as mu from 'mobx-utils';
import * as Rx from 'rxjs';
import * as T from './table';
import 'babel-polyfill';
import * as qs from 'querystring';

// defined by webpack
declare var VERSIONS: string[];

interface SingleEvalResult {
    confusion_matrix?: number[][],
    "selected": number,
    "relevant": number,
    "true_positives": number,
    "false_positives": number,
    "false_negatives": number,
    "precision": number,
    "recall": number,
    "f1_score": number,
}
interface EvalResult {
    shown?: true,
    config: {
        margin_of_error: [number, number],
        min_talk_len: number | null,
        threshold: number,
        epoch: string,
        weights_file: string,
        sigma_ms: number | undefined,
        smoother?: {
            type: string,
            factor?: number,
            sigma_ms?: number,
        }
    },
    totals: { eval: SingleEvalResult, valid: SingleEvalResult }
}
interface ConfigJSON {
    extract_config: {
        input_features: string[],
        extraction_method: {
            type: "discrete",
            bc: [number, number],
            nbc: [number, number]
        },
        useOriginalDB: true,
        useWordsTranscript: false,
        sample_window_ms: 32
    },
    train_config: {
        model_function: string;
        epochs: number;
        context_ms: number;
        context_stride: number;
        layer_sizes: (number | null)[];
        resume_parameters: string | null;
        update_method: "sgd" | "adam";
        learning_rate: number;
        l2_regularization?: number;
        num_labels: number;
        batch_size: number;
        gaussian: false;
        output_type: "single";
        context_frames: number;
        category_names?: string[];
        input_dim: number;
    },
    train_output: {
        stats: { [epoch: string]: { [attribute: string]: number } },
        source: string,
        environment?: {
            SLURM_JOB_ID?: string
        }
    },
}
const path = (version: string, file: string) => `../../../trainNN/out/${version}/${file}`;
const evalResult = (version: string) => `../../../evaluate/out/${version}/results.json`;
const titles = {
    "v026-sgd-1": "sgd, learning rate=1",
    "v027-momentum-1": "momentum, learning rate=1",
    "v028-nesterov-1": "nesterov, learning rate=1",
    "v029-adadelta-1": "adadelta, learning rate=1"
} as { [version: string]: string };
const ignore = [
    "v036-online-lstm", "v036-online-lstm-dirty"
]

type VGPropsMaybe = { ok: false, error: string, version: string, log: string | null } | VGProps;
type VGProps = { ok: true, evalInfo?: EvalResult[], config: ConfigJSON, version: string, data: { datasets: { label: string, yAxisID: string, data: { x: number, y: number }[] }[] }, options: any };

let query = qs.parse((location.search || "").substring(1));
function persist<T>({ initial, prefix = "" }: { initial: T, prefix?: string }) {
    return (prototype: Object, name: string) => {
        const stored = query[prefix + name];
        const value = observable(stored === undefined ? initial : JSON.parse(stored));
        Object.defineProperty(prototype, name, {
            get: () => value.get(),
            set: (v) => {
                value.set(v);
                query[prefix + name] = JSON.stringify(v);
                history.replaceState(null, "", "?" + qs.stringify(query));
            }
        });
    };
}

function StringEnum<T extends string>(...values: T[]): {[x in T]: x} {
    return Object.assign({}, ...values.map(value => ({ [value as any]: value })));
}
const xextractors: { [xaxis: string]: (r: EvalResult) => number } = {
    "Epoch": r => +r.config.epoch,
    "Margin of Error Center": r => r.config.margin_of_error.reduce((a, b) => (a + b) / 2),
    "Margin of Error Width": r => r.config.margin_of_error.reduce((a, b) => +(b - a).toFixed(3)),
    "Min Talk Len": r => r.config.min_talk_len === null ? -1 : r.config.min_talk_len,
    "Smoother": r => (r.config.smoother ? r.config.smoother.type : "gauss") as any,
    "Sigma": r => (r.config.sigma_ms === undefined ? r.config.smoother ? r.config.smoother.sigma_ms || r.config.smoother.factor : 300 : r.config.sigma_ms) as any,
    "Threshold": r => r.config.threshold,
};
const yextractors: { [yaxis: string]: (r: EvalResult) => number } = {
    "Valid: Precision": r => r.totals.valid.precision,
    "Valid: Recall": r => r.totals.valid.recall,
    "Valid: F1 Score": r => r.totals.valid.f1_score,
    "Eval: Precision": r => r.totals.eval.precision,
    "Eval: Recall": r => r.totals.eval.recall,
    "Eval: F1 Score": r => r.totals.eval.f1_score
}
const colors = "#3366CC,#DC3912,#FF9900,#109618,#990099,#3B3EAC,#0099C6,#DD4477,#66AA00,#B82E2E,#316395,#994499,#22AA99,#AAAA11,#6633CC,#E67300,#8B0707,#329262,#5574A6,#3B3EAC".split(",");
const toPrecision = (x: number | null) => typeof x === "number" ? x.toPrecision(3) : x;
const toTableData = mobx.createTransformer(function toTableData(v: EvalResult) {
    return {
        ...Object.assign({}, ...Object.keys(xextractors).map(name => ({ [name]: toPrecision(xextractors[name](v)) }))),
        ...Object.assign({}, ...Object.keys(yextractors).map(name => ({ [name]: toPrecision(yextractors[name](v)) }))),
    }
});
const toJS = mobx.createTransformer(x => mobx.toJS(x));
@observer
class VersionEvalDetailGUI extends React.Component<VGProps, {}> {
    validXaxes = Object.keys(xextractors);
    @observable config = {
        xaxis: "Margin of Error Center",
        yaxes: ["Valid: F1 Score", "Valid: Precision", "Valid: Recall"],
        which: null as string | null
    }
    render() {
        const { xaxis, yaxes, which } = this.config;
        if (!this.props.evalInfo) return <div>no evaluation data</div>;
        const options = {
            scales: {
                xAxes: [{
                    type: 'linear',
                    position: 'bottom',
                    scaleLabel: {
                        visible: true,
                        labelString: xaxis
                    }
                }],
                yAxes: [
                    { position: "left", id: "rating", ticks: { min: 0 } },
                    /*{ position: "right", id: "Error", scaleLabel: { display: true, labelString: "Error" }, ticks: {} }*/
                ]
            }
        };
        const _ = this.validXaxes; type XAxis = keyof typeof _;
        const map = new Map<string, EvalResult[]>();

        const extractor = xextractors[xaxis];
        const { [xaxis]: mine, ...otherso } = xextractors;
        const others = Object.keys(otherso).sort();
        for (const evalInfo of this.props.evalInfo) {
            const myValue = mine(evalInfo);
            const otherValues = JSON.stringify(Object.assign(others.map(extractor => ({ [extractor]: xextractors[extractor](evalInfo) }))));
            if (!map.has(otherValues)) map.set(otherValues, []);
            map.get(otherValues)!.push(evalInfo);
        }
        let relevants: EvalResult[];
        if (which && map.has(which)) relevants = map.get(which)!;
        else {
            let newwhich: string;
            [newwhich, relevants] = Array.from(map.entries()).reduce((a, b) => a[1].length > b[1].length ? a : b)!;
            setTimeout(() => this.config.which = newwhich, 0);
        }
        console.log(map);
        const datasets = yaxes.map((yaxis, i) => {
            const data = relevants.map(ele => ({ x: extractor(ele), y: yextractors[yaxis](ele) }));
            data.sort((a, b) => a.x - b.x);
            console.log(data);
            return {
                label: yaxis,
                borderColor: colors[i],
                fill: false,
                yAxisID: "rating",
                lineTension: 0.2,
                pointRadius: 2,
                data
            };
        });
        console.log(yaxes);
        return (
            <div>
                x-axis: <Select searchable={false} clearable={false}
                    value={xaxis}
                    options={Object.keys(xextractors).map(value => ({ value, label: value }))}
                    onChange={v => this.config.xaxis = (v as any).value} />
                y-axis: <Select searchable={false} clearable={false}
                    value={toJS(yaxes)}
                    options={Object.keys(yextractors).map(value => ({ value, label: value }))}
                    multi
                    onChange={x => this.config.yaxes = (x as any[]).map(x => x.value)} />
                which series: <Select searchable={false} clearable={false}
                    value={which || undefined}
                    options={[...map.keys()].map(key => ({ value: key, label: `${map.get(key)!.length}×: ${key}` }))}
                    onChange={x => this.config.which = (x as any).value}
                />
                <Line data={{ datasets }} options={options} />
                <Table className="evalTable" sortable
                    itemsPerPage={6}
                    filterable={"Margin of Error Width,Threshold,Min Talk Len".split(",")}
                    data={relevants.map(v => toTableData(v))}
                />
            </div>
        )
    }
}


@observer
class VersionEpochsGUI extends React.Component<VGProps, {}> {
    @observable showPlot = false;
    render() {
        const { evalInfo, version, data, options } = this.props;
        /*if(evalInfo)
            var [bestIndex, bestValue] = evalInfo.map(res => res.totals.eval !== null ? res.totals.eval.precision : res.totals.precision)
                .reduce(([maxInx, max], cur, curInx) => cur > max ? [curInx, cur] : [maxInx, max], [-1, -Infinity]);*/
        const isNewerVersion = +version.slice(1, 4) >= 42;
        if (isNewerVersion) {
            var defaultSort = { column: 'Valid: F1 Score', direction: 'desc' };
        } else {
            var defaultSort = { column: 'Eval: F1 Score', direction: 'desc' };
        }
        return (
            <div>
                <button onClick={() => this.showPlot = !this.showPlot}>show plot</button>
                {this.showPlot && <Line data={toJS(data)} options={toJS(options)} />}
                {this.showPlot && evalInfo &&
                    <div>
                        Eval Results for best epoch according to val_error ({evalInfo[0].config.weights_file}):
                    <Table className="evalTable" sortable
                            defaultSort={defaultSort} itemsPerPage={6}
                            filterable={"Margin of Error Width,Threshold,Min Talk Len".split(",")}
                            data={evalInfo.map(v => toTableData(v))}
                        />
                    </div>
                }
            </div>
        );
    }
}

const logStyle = { maxHeight: "400px", overflow: "scroll" };
function LogGui(p: VGProps) {
    let res = observable({ txt: "Loading..." });
    (async () => {
        res.txt = await (await fetch(path(p.version, "train.log"))).text();
    })();
    return <Observer>{() => <pre style={logStyle}>{res.txt}</pre>}</Observer>;
}
@observer class ConfusionDisplay extends React.Component<VGProps, {}> {
    @observable normalize = "none";
    render() {
        const best = bestResult(this.props.evalInfo!);
        let confusion: number[][] = best.totals.eval.confusion_matrix!;
        console.log(confusion);
        const category = (id: number) => this.props.config.train_config.category_names![id] || "No BC";
        let confusionStr;
        let style = (val: string) => ({} as any);
        if (this.normalize === "rows") {
            confusionStr = confusion.map(row => { var sum = row.reduce((a, b) => a + b); return row.map(v => (v / sum * 100).toPrecision(3) + "%"); });
            style = (val: string) => ({ backgroundColor: `rgba(0,0,0,${+(val.substr(0, val.length - 1)) / 200}` });
        } else if (this.normalize === "cols") {
            const colSums = confusion[0].map((_, column) => confusion.map(row => row[column]).reduce((a, b) => a + b));
            confusionStr = confusion.map(row => row.map((v, vi) => (v / colSums[vi] * 100).toPrecision(3) + "%"));
            style = (val: string) => ({ backgroundColor: `rgba(0,0,0,${+(val.substr(0, val.length - 1)) / 200}` });
        } else {
            confusionStr = confusion.map(row => row.map(v => String(v)));
        }
        const data = confusionStr.map((row, correct) => Object.assign({ "correct \\ predicted": category(correct) }, ...row.map((count, predicted) => ({ [category(predicted)]: count }))));
        return (
            <div>
                <label>Normalize:
                    <Select clearable={false} searchable={false} value={this.normalize} options={"none,rows,cols".split(",").map(value => ({ value, label: value }))} onChange={(x: Select.Option) => this.normalize = String(x.value)} />
                </label>
                <Table>
                    {data.map(row => <Tr>{Object.entries(row).map(([col, val]) => <Td style={style(val)} column={col}>{val}</Td>)}</Tr>)}
                </Table>
            </div>
        )
    }
}
@observer
class VersionGUI extends React.Component<{ gui: GUI, p: VGPropsMaybe }, {}> {
    @observable tab = 0;
    render() {
        const p = this.props.p;
        const version = p.version;
        const isNewerVersion = +version.slice(1, 4) >= 42;
        if (isNewerVersion) {
            var [gitversion, title] = version.split(":");
        } else {
            var gitversion = version;
            var title = titles[version];
        }
        if (p.ok) {
            const { evalInfo } = p;
            const confusion = evalInfo && evalInfo[0].totals.valid.confusion_matrix;
            var inner = (
                <Tabs onSelect={i => this.tab = i} selectedIndex={this.tab}>
                    <TabList>
                        <Tab>Training Graph</Tab>
                        <Tab>Training Log</Tab>
                        {evalInfo && <Tab>Eval Detail Graphs ({evalInfo.length} evaluations) </Tab>}
                        {confusion && <Tab>Confusion</Tab>}
                    </TabList>
                    <TabPanel><VersionEpochsGUI {...p} /></TabPanel>
                    <TabPanel><LogGui {...p} /></TabPanel>
                    {evalInfo && <TabPanel><VersionEvalDetailGUI {...p} /></TabPanel>}
                    {confusion && <TabPanel><ConfusionDisplay {...p} /></TabPanel>}
                </Tabs>
            );
        } else {
            inner = (
                <div><p>Error: {p.error}</p>
                    {p.log ? <div>Log: <pre style={logStyle}>{p.log}</pre></div> : <div>(Log file could not be loaded)</div>}
                </div>
            );
        }
        return (
            <div>
                <button style={{ float: "right" }} onClick={() => util.copyToClipboard(`trainNN/out/${version}/config.json`)}>copy config path</button>
                <button style={{ float: "right" }} onClick={() => this.props.gui.load(version)}>reload</button>
                <h3>{title ? `${title}` : `${version}`}</h3>
                <p>
                    Git version: {gitversion}{" "}
                    <a target="_blank" href={path(version, "config.json")}>Complete configuration json</a>
                    <a target="_blank" href={path(version, "train.log")}>Training log</a>
                    {isNewerVersion || <a target="_blank" href={path(version, "network_model.py")}>Network model</a>}
                    {p.ok && p.evalInfo && <a target="_blank" href={evalResult(version)}>Eval Result json</a>}
                    {p.ok && p.config.train_output.environment
                        && p.config.train_output.environment.SLURM_JOB_ID
                        && "Slurm ID " + p.config.train_output.environment.SLURM_JOB_ID}
                </p>
                {inner}
            </div>
        );
    }
}

const axis_keys = [{
    key: "training_loss",
    color: "blue",
    axis: "Loss"
}, {
    key: "validation_loss",
    color: "red",
    axis: "Loss"
}, {
    key: "validation_error",
    color: "green",
    axis: "Error"
}];
function maxByKey<T>(data: T[], extractor: (t: T) => number) {
    return data.reduce((curMax, ele) => extractor(curMax) > extractor(ele) ? curMax : ele);
}
function mapObject<A, K extends keyof A, B>(obj: A, mapper: (x: A[K], k: K) => B): {[x in keyof A]: B} {
    const result = {} as any;
    for (const [key, entry] of Object.entries(obj)) {
        result[key] = mapper(entry, key as K);
    }
    return result;
}
const bestResult = mobx.createTransformer((data: EvalResult[]) => {
    return maxByKey(data, info => info.totals.valid.f1_score);
});
@observer class OverviewStats extends React.Component<{ results: VGPropsMaybe[] }, {}> {

    render() {
        const results = this.props.results.filter(res => res.ok && res.evalInfo).map(res => ({ version: res.version, info: bestResult((res as VGProps).evalInfo!) }));
        return (
            <div>
                <h4>Best for each</h4>
                <Table className="evalTable"
                    defaultSort={{ column: 'Valid: F1 Score', direction: 'desc' }}
                    data={results.map(result => ({ Git: result.version.split(":")[0], Version: result.version.split(":")[1], ...toTableData(result.info) }))}
                    sortable filterable />
            </div>
        );
    }
}

@observer
class MakeLatexTable extends React.Component<{ gui: GUI, results: VGPropsMaybe[] }, {}> {
    pdimensions: { [name: string]: (p: VGProps) => string } = {
        "Context": (p: VGProps) => p.config.train_config.context_ms + "ms",
        "Stride": (p) => p.config.train_config.context_stride + "",
        "Features": (p) => p.config.extract_config.input_features.map(s => s.substr(s.indexOf("_") + 1)).join(", "),
        "Precision": (p) => this.bestTotals(p).precision.toFixed(3),
        "Recall": (p) => this.bestTotals(p).recall.toFixed(3),
        "F1-Score": (p) => this.bestTotals(p).f1_score.toFixed(3),
        "Layers": p => "$in \\rightarrow " + p.config.train_config.layer_sizes.join(" \\rightarrow ") + " \\rightarrow out$"
    }
    bestTotals(p: VGProps) {
        let x = bestResult(p.evalInfo!).totals;
        if (this.evalOrValid === "eval") return x.eval;
        else return x.valid;
    }
    @observable evalOrValid = "valid";
    @observable dimensions = ["Context"];
    render() {
        let res = this.props.results.filter(result => result.ok && result.evalInfo) as VGProps[];
        res = res.sort((a, b) => this.bestTotals(a).f1_score - this.bestTotals(b).f1_score);
        const dimensions = [...this.dimensions, "Precision", "Recall", "F1-Score"];
        const text = String.raw`
        \begin{tabular}{${dimensions.map(_ => "c").join("|")}}
            ${dimensions.join(" & ")} \\
            \svhline
            ${res.map(res => dimensions.map(dimension => this.pdimensions[dimension](res)).join(" & ")).join(" \\\\\n")}
        \end{tabular}
    `.split("\n").map(x => x.trim()).join("\n").trim();
        return (
            <div style={{ margin: "1em", padding: "0.3em", boxShadow: "10px 10px 54px -7px rgba(0,0,0,0.75)" }}>
                <Select clearable={false} searchable={false} options={"eval,valid".split(",").map(x => ({ value: x, label: x }))}
                    value={this.evalOrValid} onChange={(e: any) => this.evalOrValid = e.value} />
                <Select clearable={false} searchable={false} multi options={Object.keys(this.pdimensions).map(x => ({ value: x, label: x }))}
                    value={toJS(this.dimensions)} onChange={(e: Select.Option[]) => this.dimensions = e.map(x => String(x.value))} />
                <button onClick={() => util.copyToClipboard(text)}>Copy to Clipboard</button>
                <pre>
                    {text}
                </pre>
            </div>
        );
    }
}
@observer
class GUI extends React.Component<{}, {}> {
    constructor() {
        super();
        this.retrieveData();
    }
    @persist({ initial: false }) useMinMax: boolean;
    @persist({ initial: true }) onlyEvaluated: boolean;
    @persist({ initial: false }) onlyUnevaluated: boolean;
    @persist({ initial: true }) onlyNew: boolean;
    @persist({ initial: false }) onlyFailed: boolean;
    @persist({ initial: true }) onlyOk: boolean;
    @persist({ initial: [] }) visible: string[];

    @observable results = observable.map() as any as Map<string, VGPropsMaybe>;
    @observable loaded = 0; @observable total = 1;
    axisMinMax(results: VGPropsMaybe[], filter: string, axisId: string) {
        const arr = results.filter(result => this.resultVisible(result, filter))
            .map(arr => !arr.ok ? [] : arr.data.datasets.filter(dataset => dataset.yAxisID === axisId).map(dataset => dataset.data.map(data => data.y)));
        const data = arr.reduce((a, b) => a.concat(b.reduce((a, b) => a.concat(b)), [] as number[]), [] as number[]);
        const min = Math.min(...data);
        const max = Math.max(...data);
        return { min, max };
    }
    options(results: VGPropsMaybe[], filter: string) {
        return {
            scales: {
                xAxes: [{
                    type: 'linear',
                    position: 'bottom'
                }],
                yAxes: [
                    { position: "left", id: "Loss", scaleLabel: { display: true, labelString: "Loss" }, ticks: this.useMinMax ? this.axisMinMax(results, filter, "Loss") : {} },
                    { position: "right", id: "Error", scaleLabel: { display: true, labelString: "Error" }, ticks: this.useMinMax ? this.axisMinMax(results, filter, "Error") : {} }
                ],
            },
            animation: { duration: 0 }
        };
    }
    async errorTryGetLog(version: string, error: string): Promise<VGPropsMaybe> {
        const resp = await fetch(path(version, "train.log"));
        let log = null;
        if (resp.ok) {
            log = await resp.text();
        }
        return { ok: false, version, error, log };
    }
    async load(version: string) {
        const res = await this.retrieveDataFor(version);
        if (res) this.results.set(version, res);
    }
    async retrieveDataFor(version: string): Promise<VGPropsMaybe | null> {
        const resp = await fetch(path(version, "config.json"));
        if (!resp.ok) {
            return await this.errorTryGetLog(version, `${path(version, "config.json")} could not be found`);
        }
        let data;
        try {
            data = await resp.json() as ConfigJSON;
        } catch (e) {
            return await this.errorTryGetLog(version, `Error parsing ${version}/config.json: ${e}`);
        }
        const evalResp = await fetch(evalResult(version));
        let evalInfo: EvalResult[] | undefined;
        if (evalResp.ok) evalInfo = await (evalResp.json());
        if (evalInfo) {
            // upgrade
            evalInfo = evalInfo.map(x => x.totals.eval ? x : { ...x, totals: { eval: {}, valid: x.totals } } as any);
            evalInfo.forEach(i => i.totals.valid.f1_score === 1 && (i.totals.valid.f1_score = 0));
            evalInfo.forEach(i => i.totals.eval.f1_score === 1 && (i.totals.eval.f1_score = 0));
        }
        const stats = data.train_output.stats;

        if (!stats["0"]["validation_loss"]) return null;
        const plotData = axis_keys.map((info, i) => ({
            label: info.key,
            borderColor: colors[i],
            fill: false,
            yAxisID: info.axis,
            lineTension: 0.2,
            pointRadius: 2,
            data: Object.entries(stats).map(([x, stat]) => ({
                x: +x,
                y: stat[info.key]
            }))
        }));
        return {
            ok: true,
            version,
            evalInfo,
            data: {
                datasets: plotData
            },
            config: data,
            options: {}
        };
    }
    async retrieveData() {
        const relevant = VERSIONS.filter(version => !ignore.includes(version)).map(version => ({ version }));
        this.total = relevant.length + 1;
        const promi: Promise<any>[] = [];
        for (const { version } of relevant) {
            promi.push(this.load(version).then(() => this.loaded++));
        }
        await Promise.all(promi);
        this.loaded = this.total;
    }
    @persist({ initial: ".*" }) filter: string;
    getFilter = () => this.filter;
    getResults = () => this.results;
    resultVisible(result: VGPropsMaybe, filter: string) {
        let results = [result];
        if (this.onlyEvaluated) results = results.filter(res => res.ok && res.evalInfo);
        if (this.onlyUnevaluated) results = results.filter(res => !(res.ok && res.evalInfo));
        if (this.onlyNew) results = results.filter(res => res.version.indexOf("unified") >= 0);
        if (this.onlyFailed) results = results.filter(res => !res.ok);
        if (this.onlyOk) results = results.filter(res => res.ok);
        try {
            const fltr = RegExp(filter);
            results = results.filter(res => res.version.search(fltr) >= 0);
        } catch (e) {
            console.log("invalid regex", filter);
            return false;
        }
        return !!results[0];
    }
    @observable showMakeTable = false;
    render() {
        const throttledFilter = util.throttleGet(500, this.getFilter);
        let results = Array.from(util.throttleGet(2000, this.getResults).values());
        results = results.sort((a, b) => a.version.localeCompare(b.version));
        results = results.filter(result => this.resultVisible(result, throttledFilter));
        const options = this.options(results, throttledFilter);
        return (
            <div>
                <div>
                    <label>Only evaluated:
                        <input type="checkbox" checked={this.onlyEvaluated} onChange={x => this.onlyEvaluated = x.currentTarget.checked}
                        />
                    </label>
                    <label>Only unevaluated:
                        <input type="checkbox" checked={this.onlyUnevaluated} onChange={x => this.onlyUnevaluated = x.currentTarget.checked}
                        />
                    </label>
                    <label>Use fixed min/max:
                        <input type="checkbox" checked={this.useMinMax} onChange={x => this.useMinMax = x.currentTarget.checked}
                        />
                    </label>
                    <label>Only unified:
                        <input type="checkbox" checked={this.onlyNew} onChange={x => this.onlyNew = x.currentTarget.checked}
                        />
                    </label>
                    <label>Only failed:
                        <input type="checkbox" checked={this.onlyFailed} onChange={x => this.onlyFailed = x.currentTarget.checked}
                        />
                    </label>
                    <label>Only ok:
                        <input type="checkbox" checked={this.onlyOk} onChange={x => this.onlyOk = x.currentTarget.checked}
                        />
                    </label>
                </div>
                <label>Filter:
                    <Observer>
                        {() => <input value={this.filter} onChange={e => this.filter = e.currentTarget.value} />}
                    </Observer>
                </label>
                <button onClick={() => this.showMakeTable = !this.showMakeTable}>Show Table Maker</button>
                <Observer>{() => this.showMakeTable ? <MakeLatexTable gui={this} results={results} /> : <span />}</Observer>
                <Observer>
                    {() => this.loaded < this.total ? <h3>Loading ({this.loaded}/{this.total})...</h3> : <h3>Loading complete</h3>}
                </Observer>
                <OverviewStats results={results} />
                <div className="gui">
                    {results.map(info => <VersionGUI key={info.version} gui={this} p={{ ...info, options }} />)}
                </div>
            </div>
        );
    }
}
export let gui: any;
document.addEventListener("DOMContentLoaded", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    gui = ReactDOM.render(<GUI />, div);
});

declare var module: any;
Object.assign(window, { plot: module.exports, mu, Rx, mobx })
