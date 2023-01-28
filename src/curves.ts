import * as Scalar from "./scalar.js";
import buildBn128 from "./bn128.js";
import buildBls12381 from "./bls12381.js";
import { ModuleBuilder } from "wasmbuilder";

type CurveNames = "BN128" | "BN254" | "ALTBN128" | "BLS12381"

const bls12381r = Scalar.e("73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001", 16);
const bn128r = Scalar.e("21888242871839275222246405745257275088548364400416034343698204186575808495617");

const bls12381q = Scalar.e("1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab", 16);
const bn128q = Scalar.e("21888242871839275222246405745257275088696311157297823662689037894645226208583");

export async function getCurveFromR(r: Scalar.BigIntish & Scalar.BigIntStringish, singleThread: boolean, plugins?: (moduleBuilder: ModuleBuilder) => void) {
    let curve;
    if (Scalar.eq(r, bn128r)) {
        curve = await buildBn128(singleThread, plugins);
    } else if (Scalar.eq(r, bls12381r)) {
        curve = await buildBls12381(singleThread, plugins);
    } else {
        throw new Error(`Curve not supported: ${Scalar.toString(r)}`);
    }
    return curve;
}

export async function getCurveFromQ(q: Scalar.BigIntish & Scalar.BigIntStringish, singleThread: boolean, plugins?: (moduleBuilder: ModuleBuilder) => void) {
    let curve;
    if (Scalar.eq(q, bn128q)) {
        curve = await buildBn128(singleThread, plugins);
    } else if (Scalar.eq(q, bls12381q)) {
        curve = await buildBls12381(singleThread, plugins);
    } else {
        throw new Error(`Curve not supported: ${Scalar.toString(q, 16)}`);
    }
    return curve;
}

export async function getCurveFromName(name: CurveNames | string, singleThread: boolean, plugins?: (moduleBuilder: ModuleBuilder) => void) {
    let curve;
    const normName = normalizeName(name);
    if (["BN128", "BN254", "ALTBN128"].indexOf(normName) >= 0) {
        curve = await buildBn128(singleThread, plugins);
    } else if (["BLS12381"].indexOf(normName) >= 0) {
        curve = await buildBls12381(singleThread, plugins);
    } else {
        throw new Error(`Curve not supported: ${name}`);
    }
    return curve;

    function normalizeName(n: string) {
        return n.toUpperCase().match(/[A-Za-z0-9]+/g)!.join("");
    }

}
