import WasmField1 from "./wasm_field1.js";
import WasmField2 from "./wasm_field2.js";
import WasmField3 from "./wasm_field3.js";
import WasmCurve from "./wasm_curve.js";
import buildThreadManager, { ThreadManager } from "./threadman.js";

import * as Scalar from "./scalar.js";
import buildBatchApplyKey from "./engine_applykey.js";
import buildPairing, { Pairing } from "./engine_pairing.js";
import buildMultiExp from "./engine_multiexp.js";
import buildFFT from "./engine_fft.js";

export type Curve = {
    q: BigInt,
    r: BigInt,
    name: string, // TODO: make enum
    tm: ThreadManager,
    prePSize: number,
    preQSize: number,
    Fr: WasmField1,
    F1: WasmField1,
    F2: WasmField2,
    G1: WasmCurve,
    G2: WasmCurve,
    F6: WasmField3,
    F12: WasmField2,
    Gt: WasmField2,
    array2buffer: (arr: Array<Uint8Array>, sG: number) => Uint8Array,
    buffer2array: (buff: Uint8Array, sG: number) => Array<Uint8Array>,
} & Pairing

export default async function buildEngine(params: {
    wasm: any,
    name: string,
    singleThread: boolean,
    n8r: number,
    r: number,
    n8q: number,
    q: number,
    cofactorG1: number,
    cofactorG2: number,
}): Promise<Curve> {

    const tm = await buildThreadManager(params.wasm, params.singleThread);
    const curve: Partial<Curve> = {};

    curve.q = Scalar.e(params.wasm.q.toString());
    curve.r = Scalar.e(params.wasm.r.toString());
    curve.name = params.name;
    curve.tm = tm;
    curve.prePSize = params.wasm.prePSize;
    curve.preQSize = params.wasm.preQSize;
    curve.Fr = new WasmField1(tm, "frm", params.n8r, params.r);
    curve.F1 = new WasmField1(tm, "f1m", params.n8q, params.q);
    curve.F2 = new WasmField2(tm, "f2m", curve.F1);
    curve.G1 = new WasmCurve(tm, "g1m", curve.F1, params.wasm.pG1gen, params.wasm.pG1b, params.cofactorG1);
    curve.G2 = new WasmCurve(tm, "g2m", curve.F2, params.wasm.pG2gen, params.wasm.pG2b, params.cofactorG2);
    curve.F6 = new WasmField3(tm, "f6m", curve.F2);
    curve.F12 = new WasmField2(tm, "ftm", curve.F6);

    curve.Gt = curve.F12;

    const _curve = curve as Curve;

    buildBatchApplyKey(_curve, "G1");
    buildBatchApplyKey(_curve, "G2");
    buildBatchApplyKey(_curve, "Fr");

    buildMultiExp(_curve as Curve, "G1");
    buildMultiExp(_curve as Curve, "G2");

    buildFFT(_curve, "G1");
    buildFFT(_curve, "G2");
    buildFFT(_curve, "Fr");

    buildPairing(_curve);

    curve.array2buffer = function (arr: Array<Uint8Array>, sG: number) {
        const buff = new Uint8Array(sG * arr.length);

        for (let i = 0; i < arr.length; i++) {
            buff.set(arr[i], i * sG);
        }

        return buff;
    };

    curve.buffer2array = function (buff: Uint8Array, sG: number) {
        const n = buff.byteLength / sG;
        const arr = new Array<Uint8Array>(n);
        for (let i = 0; i < n; i++) {
            arr[i] = buff.slice(i * sG, i * sG + sG);
        }
        return arr;
    };

    return curve as Curve;
}


