import BigBuffer from "./bigbuffer.js";
import { FFTType, GroupName } from "./engine_fft.js";
import { BigIntish } from "./scalar.js";
import { ThreadManager } from "./threadman.js";
import { ThreadTask } from "./threadman_thread.js";
import WasmField1 from "./wasm_field1.js"; 
import WasmField2 from "./wasm_field2.js";
import WasmField3 from "./wasm_field3.js";

type BatchApplyKey = 
    ((buff: Uint8Array, first: BigIntish, inc: BigIntish, inType?: FFTType, outType?: FFTType) => Promise<Uint8Array>) |
    ((buff: BigBuffer, first: BigIntish, inc: BigIntish, inType?: FFTType, outType?: FFTType) => Promise<BigBuffer>)

export default function buildBatchApplyKey(
    curve: {
        Fr: WasmField1,
        tm: ThreadManager,
    } & Record<GroupName, { 
        F: WasmField1 | WasmField2 | WasmField3, // TODO: create function overload for different group names
        n8: number, // TODO: 
        batchApplyKey: BatchApplyKey 
    }>,
    groupName: GroupName
) {
    const G = curve[groupName];
    const Fr = curve.Fr;
    const tm = curve.tm;

    async function batchApplyKey(buff: Uint8Array, first: BigIntish, inc: BigIntish, inType?: FFTType, outType?: FFTType): Promise<Uint8Array>;
    async function batchApplyKey(buff: BigBuffer, first: BigIntish, inc: BigIntish, inType?: FFTType, outType?: FFTType): Promise<BigBuffer>;
    async function batchApplyKey(buff: Uint8Array | BigBuffer, first: BigIntish, inc: BigIntish, inType?: FFTType, outType?: FFTType) {
        inType = inType || "affine";
        outType = outType || "affine";
        let fnName, fnAffine;
        let sGin, sGmid, sGout;
        if (groupName == "G1") {
            if (inType == "jacobian") {
                sGin = G.F.n8 * 3;
                fnName = "g1m_batchApplyKey";
            } else {
                sGin = G.F.n8 * 2;
                fnName = "g1m_batchApplyKeyMixed";
            }
            sGmid = G.F.n8 * 3;
            if (outType == "jacobian") {
                sGout = G.F.n8 * 3;
            } else {
                fnAffine = "g1m_batchToAffine";
                sGout = G.F.n8 * 2;
            }
        } else if (groupName == "G2") {
            if (inType == "jacobian") {
                sGin = G.F.n8 * 3;
                fnName = "g2m_batchApplyKey";
            } else {
                sGin = G.F.n8 * 2;
                fnName = "g2m_batchApplyKeyMixed";
            }
            sGmid = G.F.n8 * 3;
            if (outType == "jacobian") {
                sGout = G.F.n8 * 3;
            } else {
                fnAffine = "g2m_batchToAffine";
                sGout = G.F.n8 * 2;
            }
        } else if (groupName == "Fr") {
            fnName = "frm_batchApplyKey";
            sGin = G.n8;
            sGmid = G.n8;
            sGout = G.n8;
        } else {
            throw new Error("Invalid group: " + groupName);
        }
        const nPoints = Math.floor(buff.byteLength / sGin);
        const pointsPerChunk = Math.floor(nPoints / tm.concurrency!);
        const opPromises = [];
        const incBuff = Fr.e(inc);
        let t = Fr.e(first);
        for (let i = 0; i < tm.concurrency!; i++) {
            let n;
            if (i < tm.concurrency! - 1) {
                n = pointsPerChunk;
            } else {
                n = nPoints - i * pointsPerChunk;
            }
            if (n == 0) continue;

            const task: ThreadTask[] = [];

            task.push({
                cmd: "ALLOCSET",
                var: 0,
                buff: buff.slice(i * pointsPerChunk * sGin, i * pointsPerChunk * sGin + n * sGin)!
            });
            task.push({ cmd: "ALLOCSET", var: 1, buff: t });
            task.push({ cmd: "ALLOCSET", var: 2, buff: incBuff });
            task.push({ cmd: "ALLOC", var: 3, len: n * Math.max(sGmid, sGout) });
            task.push({
                cmd: "CALL",
                fnName: fnName,
                params: [
                    { var: 0 },
                    { val: n },
                    { var: 1 },
                    { var: 2 },
                    { var: 3 }
                ]
            });
            if (fnAffine) {
                task.push({
                    cmd: "CALL",
                    fnName: fnAffine,
                    params: [
                        { var: 3 },
                        { val: n },
                        { var: 3 },
                    ]
                });
            }
            task.push({ cmd: "GET", out: 0, var: 3, len: n * sGout });

            opPromises.push(tm.queueAction(task));
            t = Fr.mul(t, Fr.exp(incBuff, n));
        }

        const result = await Promise.all(opPromises);

        let outBuff;
        if (buff instanceof BigBuffer) {
            outBuff = new BigBuffer(nPoints * sGout);
        } else {
            outBuff = new Uint8Array(nPoints * sGout);
        }

        let p = 0;
        for (let i = 0; i < result.length; i++) {
            outBuff.set(result[i][0], p);
            p += result[i][0].byteLength;
        }

        return outBuff;
    };

    curve[groupName].batchApplyKey = batchApplyKey;

}
