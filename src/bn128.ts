import { buildBn128 as buildBn128wasm } from "wasmcurves";
import buildEngine from "./engine.js";
import * as Scalar from "./scalar.js";
import { ModuleBuilder } from "wasmbuilder";
import { Curve } from "./engine.js"; 

declare global {
    var curve_bn128: Curve | null;
}

globalThis.curve_bn128 = null;

export type Bn128Wasm ={
    code: any,
    pq: bigint,
    pr: bigint,
    pG1gen: bigint,
    pG1zero: bigint,
    pG1b: bigint,
    pG2gen: bigint,
    pG2zero: bigint,
    pG2b: bigint,
    pOneT: bigint,
    prePSize: number,
    preQSize: number,
    n8q: number,
    n8r: number,
    q: bigint,
    r: bigint,
}

export default async function buildBn128(singleThread?: boolean, plugins?: (moduleBuilder: ModuleBuilder) => void) {

    const moduleBuilder = new ModuleBuilder();
    moduleBuilder.setMemory(25);
    buildBn128wasm(moduleBuilder);

    if (plugins) plugins(moduleBuilder);

    const bn128wasm: Partial<Bn128Wasm> = {};

    bn128wasm.code = moduleBuilder.build();
    bn128wasm.pq = moduleBuilder.modules.f1m.pq;
    bn128wasm.pr = moduleBuilder.modules.frm.pq;
    bn128wasm.pG1gen = moduleBuilder.modules.bn128.pG1gen;
    bn128wasm.pG1zero = moduleBuilder.modules.bn128.pG1zero;
    bn128wasm.pG1b = moduleBuilder.modules.bn128.pG1b;
    bn128wasm.pG2gen = moduleBuilder.modules.bn128.pG2gen;
    bn128wasm.pG2zero = moduleBuilder.modules.bn128.pG2zero;
    bn128wasm.pG2b = moduleBuilder.modules.bn128.pG2b;
    bn128wasm.pOneT = moduleBuilder.modules.bn128.pOneT;
    bn128wasm.prePSize = moduleBuilder.modules.bn128.prePSize;
    bn128wasm.preQSize = moduleBuilder.modules.bn128.preQSize;
    bn128wasm.n8q = 32;
    bn128wasm.n8r = 32;
    bn128wasm.q = moduleBuilder.modules.bn128.q;
    bn128wasm.r = moduleBuilder.modules.bn128.r;

    if ((!singleThread) && (globalThis.curve_bn128)) return globalThis.curve_bn128;
    const params = {
        name: "bn128",
        wasm: bn128wasm as Bn128Wasm,
        q: Scalar.e("21888242871839275222246405745257275088696311157297823662689037894645226208583"),
        r: Scalar.e("21888242871839275222246405745257275088548364400416034343698204186575808495617"),
        n8q: 32,
        n8r: 32,
        cofactorG2: Scalar.e("30644e72e131a029b85045b68181585e06ceecda572a2489345f2299c0f9fa8d", 16),
        singleThread: singleThread ? true : false
    };

    const curve = await buildEngine(params);
    curve.terminate = async function () {
        if (!params.singleThread) {
            globalThis.curve_bn128 = null;
            await this.tm.terminate();
        }
    };

    if (!singleThread) {
        globalThis.curve_bn128 = curve;
    }

    return curve;
}

