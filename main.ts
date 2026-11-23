import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STACK_MAX = 256, CALLS_MAX = 64, MEMORY_WORDS = 256, STEP_LIMIT = 1000000, OUTPUT_MAX = 65536;
const TRAP = { UNDERFLOW:2, OVERFLOW:3, DIV_ZERO:4, BAD_OPCODE:5, MEMORY:6, CALL_DEPTH:7, RET_EMPTY:8, PC:9, STEPS:10, OUTPUT:11 };

function run(program, input) {
  const n = program.length;
  const D = new Int32Array(STACK_MAX);
  let sp = 0;
  const C = new Int32Array(CALLS_MAX);
  let csp = 0;
  const M = new Int32Array(MEMORY_WORDS);
  const out = new Uint8Array(OUTPUT_MAX);
  let olen = 0;
  let inPos = 0;
  let pc = 0;
  let steps = 0;
  const done = (exit, trap) => ({ out: out.slice(0, olen), exit, trap, steps });
  const trapFn = (code) => done(code, code);
  const opInfo = (b) => {
    // returns [imm, pops, pushes, name]
    if (b===0x00) return [0,0,0,'HALT'];
    if (b===0x01) return [1,0,1,'PUSH8'];
    if (b===0x02) return [4,0,1,'PUSH32'];
    if (b===0x03) return [0,1,0,'POP'];
    if (b===0x04) return [0,1,2,'DUP'];
    if (b===0x05) return [0,2,2,'SWAP'];
    if (b===0x06) return [0,2,3,'OVER'];
    if (b===0x07) return [0,3,3,'ROT'];
    if (b===0x10) return [0,2,1,'ADD'];
    if (b===0x11) return [0,2,1,'SUB'];
    if (b===0x12) return [0,2,1,'MUL'];
    if (b===0x13) return [0,2,1,'DIV'];
    if (b===0x14) return [0,2,1,'MOD'];
    if (b===0x15) return [0,2,1,'DIVU'];
    if (b===0x16) return [0,2,1,'MODU'];
    if (b===0x17) return [0,1,1,'NEG'];
    if (b===0x18) return [0,2,1,'AND'];
    if (b===0x19) return [0,2,1,'OR'];
    if (b===0x1a) return [0,2,1,'XOR'];
    if (b===0x1b) return [0,1,1,'NOT'];
    if (b===0x1c) return [0,2,1,'SHL'];
    if (b===0x1d) return [0,2,1,'SHR'];
    if (b===0x1e) return [0,2,1,'SHRU'];
    if (b===0x20) return [0,2,1,'EQ'];
    if (b===0x21) return [0,2,1,'LT'];
    if (b===0x22) return [0,2,1,'LTU'];
    if (b===0x30) return [2,0,0,'JMP'];
    if (b===0x31) return [2,1,0,'JZ'];
    if (b===0x32) return [2,1,0,'JNZ'];
    if (b===0x33) return [2,0,0,'CALL'];
    if (b===0x34) return [0,0,0,'RET'];
    if (b===0x40) return [0,1,1,'LOAD'];
    if (b===0x41) return [0,2,0,'STORE'];
    if (b===0x50) return [0,1,0,'PRINT'];
    if (b===0x51) return [0,1,0,'PUTC'];
    if (b===0x52) return [0,0,1,'IN'];
    if (b===0x53) return [0,1,0,'EXIT'];
    return null;
  };
  for (;;) {
    if (steps === STEP_LIMIT) return trapFn(TRAP.STEPS);
    if (pc < 0 || pc >= n) return trapFn(TRAP.PC);
    const info = opInfo(program[pc]);
    if (!info) return trapFn(TRAP.BAD_OPCODE);
    const [imm, pops, pushes, name] = info;
    if (pc + 1 + imm > n) return trapFn(TRAP.PC);
    steps++;
    const next = pc + 1 + imm;
    if (sp < pops) return trapFn(TRAP.UNDERFLOW);
    if (sp - pops + pushes > STACK_MAX) return trapFn(TRAP.OVERFLOW);
    pc = next;
    switch (name) {
      case 'HALT': return done(0, null);
      case 'PUSH8': D[sp++] = (program[next-1] << 24) >> 24; break;
      case 'PUSH32': D[sp++] = program[next-4] | (program[next-3]<<8) | (program[next-2]<<16) | (program[next-1]<<24); break;
      case 'POP': sp--; break;
      case 'DUP': D[sp]=D[sp-1]; sp++; break;
      case 'SWAP': { const t=D[sp-1]; D[sp-1]=D[sp-2]; D[sp-2]=t; break; }
      case 'OVER': D[sp]=D[sp-2]; sp++; break;
      case 'ROT': { const a=D[sp-3]; D[sp-3]=D[sp-2]; D[sp-2]=D[sp-1]; D[sp-1]=a; break; }
      case 'NEG': D[sp-1] = -D[sp-1] | 0; break;
      case 'NOT': D[sp-1] = ~D[sp-1]; break;
      case 'ADD': case 'SUB': case 'MUL': case 'DIV': case 'MOD': case 'DIVU': case 'MODU': case 'AND': case 'OR': case 'XOR': case 'SHL': case 'SHR': case 'SHRU': case 'EQ': case 'LT': case 'LTU': {
        const b = D[sp-1], a = D[sp-2]; let r;
        if (name==='ADD') r=(a+b)|0;
        else if (name==='SUB') r=(a-b)|0;
        else if (name==='MUL') r=Math.imul(a,b);
        else if (name==='DIV') { if (b===0) return trapFn(TRAP.DIV_ZERO); r = (a===-2147483648 && b===-1) ? a : Math.trunc(a/b)|0; }
        else if (name==='MOD') { if (b===0) return trapFn(TRAP.DIV_ZERO); r = (b===-1) ? 0 : (a % b)|0; }
        else if (name==='DIVU') { if (b===0) return trapFn(TRAP.DIV_ZERO); r = Math.floor((a>>>0)/(b>>>0))|0; }
        else if (name==='MODU') { if (b===0) return trapFn(TRAP.DIV_ZERO); r = ((a>>>0)%(b>>>0))|0; }
        else if (name==='AND') r=a&b;
        else if (name==='OR') r=a|b;
        else if (name==='XOR') r=a^b;
        else if (name==='SHL') r=a<<(b&31);
        else if (name==='SHR') r=a>>(b&31);
        else if (name==='SHRU') r=(a>>>(b&31))|0;
        else if (name==='EQ') r=a===b?1:0;
        else if (name==='LT') r=a<b?1:0;
        else if (name==='LTU') r=(a>>>0)<(b>>>0)?1:0;
        sp -= 2; D[sp++]=r; break;
      }
      case 'JMP': case 'JZ': case 'JNZ': {
        const rel = ((program[next-2] | (program[next-1]<<8)) << 16) >> 16;
        let take = true;
        if (name !== 'JMP') { const v = D[--sp]; take = name==='JZ' ? v===0 : v!==0; }
        if (take) pc = next + rel;
        break;
      }
      case 'CALL': {
        if (csp === CALLS_MAX) return trapFn(TRAP.CALL_DEPTH);
        C[csp++] = next;
        pc = program[next-2] | (program[next-1]<<8);
        break;
      }
      case 'RET': {
        if (csp === 0) return trapFn(TRAP.RET_EMPTY);
        pc = C[--csp];
        break;
      }
      case 'LOAD': {
        const addr = D[sp-1];
        if (addr < 0 || addr >= MEMORY_WORDS) return trapFn(TRAP.MEMORY);
        D[sp-1] = M[addr];
        break;
      }
      case 'STORE': {
        const addr = D[sp-1];
        const v = D[sp-2];
        if (addr < 0 || addr >= MEMORY_WORDS) return trapFn(TRAP.MEMORY);
        sp -= 2; M[addr] = v;
        break;
      }
      case 'PRINT': {
        const bytes = new TextEncoder().encode(String(D[sp-1]));
        if (olen + bytes.length > OUTPUT_MAX) return trapFn(TRAP.OUTPUT);
        sp--;
        out.set(bytes, olen); olen += bytes.length;
        break;
      }
      case 'PUTC': {
        if (olen + 1 > OUTPUT_MAX) return trapFn(TRAP.OUTPUT);
        out[olen++] = D[--sp] & 255;
        break;
      }
      case 'IN': D[sp++] = inPos < input.length ? input[inPos++] : -1; break;
      case 'EXIT': return done(D[--sp] & 255, null);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(new Uint8Array(readFileSync(join(I, id, 'program.bin'))), new Uint8Array(readFileSync(join(I, id, 'input.bin'))));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), Uint8Array.from(r.out));
  writeFileSync(join(O, id, 'exit.txt'), `${r.exit}\n`);
}
