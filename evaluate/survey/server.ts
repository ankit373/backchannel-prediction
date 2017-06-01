import * as http from 'http';
import * as express from 'express';
import * as webpackMiddleware from 'webpack-dev-middleware';
import * as webpackConfig from './webpack.config';
import * as io from 'socket.io';
import * as common from './common';
import { join, basename } from 'path';
import * as glob from 'glob';
import * as Random from 'random-js';
import * as compression from 'compression';
import {
    createConnection, Connection,
} from 'typeorm';
import { openDatabase, Session, BCPrediction, NetRating } from './db';
import "reflect-metadata";
const expectedHost = [process.env.HOST, 'survey.thesis.host', 'study.thesis.host'];

function rejectUnknownHosts(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (expectedHost.indexOf(req.headers.host) < 0)
        res.status(404).send('Not found ;)');
    else next();
}
let db: Connection;
let bcSamples: common.BCSamples[];
let monosegs: string[];
let netRatingSegments: string[][];
class TwoWayMap<A, B> {
    mapA = new Map<A, B>();
    mapB = new Map<B, A>();
    hasA(x: A) {
        return this.mapA.has(x);
    }
    hasB(x: B) {
        return this.mapB.has(x);
    }
    getA(x: A) {
        return this.mapA.get(x);
    }
    getB(x: B) {
        return this.mapB.get(x);
    }
    set(x: A, y: B) {
        this.mapA.set(x, y);
        this.mapB.set(y, x);
    }
}
const nocaching = { etag: false, maxage: 0 };
const urlMap = new TwoWayMap<number, string>();
const wantedSegCount = 6;
let urlCounter = 0;
function addSecretUrl(realUrl: string) {
    const ext = realUrl.split(".").slice(-1)[0];
    const counter = ++urlCounter;
    urlMap.set(counter, realUrl);
    console.log(counter, "=", realUrl);
    return `data/${counter}.${ext}`;
}
function secretUrlToReal(secretUrl: string) {
    if (secretUrl.startsWith("data/")) secretUrl = secretUrl.substring(4);
    const id = +secretUrl.substr(1).split(".")[0];
    if (urlMap.hasA(id)) {
        return urlMap.getA(id)!;
    } else {
        console.error("not found: " + secretUrl);
        return secretUrl;
    }
}
function dataRewriter(req: express.Request, res: express.Response, next: express.NextFunction) {
    req.url = secretUrlToReal(req.url);
    res.header('Cache-Control', 'no-cache');
    next();
}
function assumeSingleGlob(path: string) {
    const g = glob.sync(path);
    if (g.length !== 1) console.error("cannot find", path);
    return g[0];
}
const meths = ["nn", "truthrandom", "random"];
const r = Random.engines.mt19937().autoSeed(); //.seed(1337);

async function listen() {
    db = await openDatabase();
    bcSamples = glob.sync(join(__dirname, "data/BC", "*/"))
        .map(dir => ({ name: basename(dir), samples: glob.sync(join(dir, "*.wav")).map(x => join("data/BC", basename(dir), basename(x))) }));
    console.log("loaded", bcSamples.length, "bc sample files");

    monosegs = glob.sync(join(__dirname, "data/mono/*.wav"));
    Random.shuffle(r, monosegs);
    monosegs.unshift(...common.preferred.map(str => assumeSingleGlob(join(__dirname, "data/mono", str + "*.wav"))));
    console.log("we have", common.preferred.length, "preferred segments, adding", wantedSegCount - common.preferred.length, "random ones");
    monosegs = monosegs.map(d => join("/mono", basename(d)));
    monosegs = monosegs.slice(0, wantedSegCount);
    netRatingSegments = monosegs
        .map(monoseg => basename(monoseg).split(".")[0])
        .map(monoseg => meths.map(meth => join(__dirname, "data", meth, monoseg + "*.mp3"))
            .map(g => assumeSingleGlob(g))
            .map(f => f.substr(join(__dirname, "data").length))
        );
    monosegs = monosegs.map(url => addSecretUrl(url));
    console.log(netRatingSegments);
    netRatingSegments = netRatingSegments.map(x => x.map(url => addSecretUrl(url)));
    console.log("loaded", monosegs.length, "monosegs");

    const app = express();
    const server = http.createServer(app);
    server.listen(process.env.PORT || 8000);
    // force compression
    // app.use((req, res, next) => (req.headers['accept-encoding'] = 'gzip', next()))
    app.use(rejectUnknownHosts);
    app.use(compression());
    app.use("/", express.static(join(__dirname, "build"), nocaching));
    app.use("/data", dataRewriter);
    app.use("/", express.static(join(__dirname, "static")));
    app.use("/data", express.static(join(__dirname, "data"), nocaching));
    app.get("/result.json", async (req, res) => {
        const session = +req.query.session;
        if (!session) {
            res.status(400).send("invalid request");
            return;
        }
        res.setHeader('Content-Type', 'application/json');
        const q = db.entityManager.createQueryBuilder(NetRating, "netRating")
            .where("netRating.final = 1")
            .innerJoinAndSelect("netRating.session", "session")
            .andWhere("session.id = :session", { session });
        const resp = await q.getMany();
        const x = {} as any;
        for (const ratingType of common.ratingTypes) {
            const name: any = {
                "nn": "Neural Net output",
                "truthrandom": "Ground Truth (random audio samples)",
                "random": "Random predictor (baseline)"
            };
            const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
            x[ratingType] = Object.assign({}, ...meths.map(meth => (
                { [name[meth]]: avg(resp.filter(x => x.ratingType === ratingType && getPredictor(x.segment) === meth).map(rating => rating.rating!)) }
            )));
        }
        res.send(JSON.stringify(x, null, "\t"));
    });
    app.get("/pcqxnugylresibwhwmzv/ratings.json", async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        const resp = await db.entityManager.createQueryBuilder(NetRating, "rating")
            .innerJoinAndSelect("rating.session", "session")
            .getMany();
        res.send(JSON.stringify(resp, (k, v) => k === 'handshake' ? JSON.parse(v) : v));
    });
    app.get("/pcqxnugylresibwhwmzv/sessions.json", async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        const resp = await db.entityManager.find(Session);
        res.send(JSON.stringify(resp, (k, v) => k === 'handshake' ? JSON.parse(v) : v));
    });
    const socket = io(server);

    socket.on('connection', initClient);
    socket.on('connect', () => console.log("connect", new Date()));
}
function range(min: number, maxExclusive: number) {
    return Array.from(Array(maxExclusive - min), (_, k) => min + k);
}
function initClient(_client: SocketIO.Socket) {
    console.log("initing client", new Date());
    const client = _client as common.TypedServerSocket;
    let session = new Session();
    const meta = _client.request;
    session.handshake = JSON.stringify(_client.handshake);
    const sessionPersisted = db.entityManager.persist(session);
    client.on("beginStudy", async (data, callback) => {
        console.log(new Date(), "beginning study");
        session.bcSampleSource = data.bcSampleSource;
        callback({ sessionId: session.id });
    });
    client.on("getData", async (options, callback) => {
        await sessionPersisted;
        const methCount = meths.length;
        const segCount = netRatingSegments.length;
        const segsPerMeth = segCount / methCount;
        if (segsPerMeth !== Math.round(segsPerMeth)) console.error("not divisible", segsPerMeth);
        const methIndices = ([] as number[]).concat(...range(0, segsPerMeth).map(() => range(0, methCount)));
        Random.shuffle(r, methIndices);
        const segments = Random.shuffle(r, netRatingSegments.slice());
        const chosen = segments.map((segs, i) => segs[methIndices[i]]);
        callback({ bcSamples, monosegs, netRatingSegments: chosen, sessionId: session.id });
    });
    client.on("submitBC", async (options, callback) => {
        const pred = new BCPrediction();
        pred.session = session;
        pred.segment = secretUrlToReal(options.segment);
        pred.time = options.time;
        pred.duration = options.duration;
        await db.entityManager.persist(pred);
        console.log("bc", pred.session.id, pred.segment, pred.time);
        callback({});
    });
    client.on("submitNetRatings", async ({ segments, final }, callback) => {
        const entities = [] as NetRating[];
        for (const [segment, rating] of segments) {
            for (const ratingType of Object.keys(rating)) {
                const x = new NetRating();
                x.rating = rating[ratingType];
                x.ratingType = ratingType;
                const realSegment = secretUrlToReal(segment);
                x.segment = realSegment;
                x.session = session;
                x.final = final;
                if (final) console.log(session.id, "rated", realSegment, "with", rating);
                entities.push(x);
            }
        }
        await db.entityManager.persist(entities);
        callback({});
    });
    client.on("comment", async (options, callback) => {
        session.comment = options;
        console.log(session.id, "comment", options);
        await db.entityManager.persist(session);
        callback({});
    })
}

listen();
