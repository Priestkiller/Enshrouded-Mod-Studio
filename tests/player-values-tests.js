'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const P=require('../engine/player-values-fix');
const root=fs.mkdtempSync(path.join(path.resolve(__dirname,'..','..'),'player-value-tests-'));
const results=[];
const clone=v=>JSON.parse(JSON.stringify(v));
function test(name,run){run();results.push(name);}
function reflection(){return {version:'OWN-PLAYER-FORMULA-FIXTURE',types:[
 {name:'BaseAttributeResource',qualifiedName:P.TYPE,primitiveType:'STRUCT',qualifiedHash:0x12345678,structFields:{structure:{type:1},ids:{type:6}}},
 {primitiveType:'BLOB_ARRAY',innerType:2},
 {qualifiedName:'keen::AttributeStructure',primitiveType:'STRUCT',structFields:{calculation:{type:3}}},
 {primitiveType:'BLOB_ARRAY',innerType:4},
 {qualifiedName:'keen::AttributeCommand',primitiveType:'TYPEDEF',size:4,innerType:5},
 {primitiveType:'UINT32',size:4},
 {primitiveType:'BLOB_ARRAY',innerType:7},
 {qualifiedName:'keen::HashKey32',primitiveType:'STRUCT'},
 {qualifiedName:'keen::AttributeOps',primitiveType:'ENUM',size:2,enumFields:{Load:{value:2},Push:{value:5},Multiply:{value:8},Clamp:{value:12}}},
 {name:'AttributeContainerResource',qualifiedName:P.CONTAINER,primitiveType:'STRUCT',qualifiedHash:0x12345679,structFields:{attributes:{type:10}}},
 {primitiveType:'BLOB_ARRAY',innerType:0}
 ]};}
function resource(){return {$type:P.TYPE,$guid:P.GUID,$part:0,type:{value:2556031774},ids:[79080075,1369213345,4098081808,3322048528,595494220,2959910128,480569669,1091875813].map(value=>({value})),debugNames:['Stamina','Stamina_Min','Stamina_Max','Stamina_RechargeRampup','Stamina_RechargeTimeout','Stamina_Recharge','Stamina_Max_Base','Stamina_Max_Adder'],structure:[
 {calculation:[131072,131073,131074,851967],childIndex:1,parentIndex:65535,siblingIndex:65535},
 {calculation:[],childIndex:65535,parentIndex:0,siblingIndex:2},
 {calculation:[196608,131073,131074,131078,131079,458751,917503],childIndex:65535,parentIndex:0,siblingIndex:3},
 {calculation:[],childIndex:65535,parentIndex:0,siblingIndex:4},
 {calculation:[],childIndex:65535,parentIndex:0,siblingIndex:5},
 {calculation:[131077,393215,0,393215,65536,851967],childIndex:65535,parentIndex:0,siblingIndex:6},
 {calculation:[],childIndex:65535,parentIndex:0,siblingIndex:7},
 {calculation:[],childIndex:65535,parentIndex:0,siblingIndex:65535}
 ]};}
function container(){const stamina=resource();delete stamina.$type;delete stamina.$guid;delete stamina.$part;const other=clone(stamina);other.ids[5].value=123;other.debugNames[5]='Other_Attribute';return {$type:P.CONTAINER,$guid:P.CONTAINER_GUID,$part:0,attributes:[other,stamina],untouched:'keep'};}
let serial=0;
function fixture(value=2){const folder=path.join(root,String(++serial)),input=path.join(folder,'input'),output=path.join(folder,'output'),ref=reflection();const file=(base,doc)=>{const type=ref.types.find(t=>t.qualifiedName===doc.$type);return path.join(base,type.name,doc.$guid+'_'+type.qualifiedHash.toString(16)+'_'+doc.$part+'.json');};const write=(base,doc)=>{fs.mkdirSync(path.dirname(file(base,doc)),{recursive:true});fs.writeFileSync(file(base,doc),JSON.stringify(doc));};const doc=resource(),compiled=container();write(input,doc);write(input,compiled);return {input,output,ref,doc,compiled,file,write,config:{player:{adjustStaminaRegen:{enabled:true,factor:value}}},apply(){return P.apply({config:this.config,reflection:this.ref},input,output);},read(){return JSON.parse(fs.readFileSync(file(output,doc)));},readContainer(){return JSON.parse(fs.readFileSync(file(output,compiled)));},verify(summary){return P.verify(summary,ref,output);}};}
// Independent tiny Q16.16 interpreter. This deliberately does not call the
// correction's calculation builder and interprets raw operator/payload words.
function execute(words,input){const stack=[];let n=0;for(;n<words.length;n++){const word=words[n]>>>0,operation=word>>>16,index=word&65535;switch(operation){case 2:assert.strictEqual(index,5);stack.push(BigInt(Math.round(input*65536)));break;case 5:assert.strictEqual(index,65535);assert(n+1<words.length);stack.push(BigInt(words[++n]|0));break;case 12:{const maximum=stack.pop(),minimum=stack.pop(),value=stack.pop();stack.push(value<minimum?minimum:value>maximum?maximum:value);break;}case 8:{const b=stack.pop(),a=stack.pop();stack.push((a*b)>>16n);break;}default:throw Error('unexpected operator '+operation);}}assert.strictEqual(stack.length,1);return Number(stack[0])/65536;}
test('disabled correction performs no filesystem or reflection access',()=>{assert.strictEqual(P.apply({config:{}},'missing','missing').enabled,false);assert.strictEqual(P.verify({enabled:false},null,'missing').checked,0);});
test('original vendor ceiling edit leaves ordinary regeneration unchanged',()=>{const words=[131077,393215,0,393215,327680,851967];assert.strictEqual(execute(words,0.25),0.25);assert.strictEqual(execute(resource().structure[5].calculation,0.25),0.25);});
test('factor5 multiplies regeneration in both definition and compiled container',()=>{const f=fixture(5),s=f.apply(),out=f.read(),compiled=f.readContainer();assert.strictEqual(execute(out.structure[5].calculation,0.125),0.625);assert.strictEqual(execute(out.structure[5].calculation,0.25),1.25);assert.deepStrictEqual(compiled.attributes[1].structure[5].calculation,out.structure[5].calculation);assert.strictEqual(f.verify(s).checked,2);});
test('original clamp precedes multiplication for negative and saturated input',()=>{const f=fixture(5);f.apply();const words=f.read().structure[5].calculation;assert.strictEqual(execute(words,-1),0);assert.strictEqual(execute(words,2),5);});
test('factor1 preserves exact baseline identity including formula length',()=>{const f=fixture(1),s=f.apply();assert.strictEqual(s.filesChanged,0);assert(!fs.existsSync(f.file(f.output,f.doc)));assert(!fs.existsSync(f.file(f.output,f.compiled)));f.write(f.output,f.doc);f.write(f.output,f.compiled);f.verify(s);assert.deepStrictEqual(f.read(),f.doc);assert.deepStrictEqual(f.readContainer(),f.compiled);});
test('fractional and boundary factors use exact fixed-point payloads',()=>{for(const value of [0.1,0.25,0.3333,1.5,5,10]){const f=fixture(value),s=f.apply(),out=f.read();assert.strictEqual(out.structure[5].calculation[7],Math.round(value*65536));assert(Math.abs(execute(out.structure[5].calculation,0.5)-value*0.5)<=1/65536);f.verify(s);}});
test('nonfinite and out-of-range factors fail before output',()=>{for(const value of [0,-1,0.099,10.001,NaN,Infinity,'5']){const f=fixture(value);assert.throws(()=>f.apply(),/Faktor/);assert(!fs.existsSync(f.output));}});
test('legacy vendor output is repaired while unrelated edits survive',()=>{const f=fixture(5),raw=clone(f.doc);raw.structure[5].calculation[4]=327680;raw.unrelatedMod=23;f.write(f.output,raw);f.apply();const out=f.read();assert.strictEqual(out.unrelatedMod,23);assert.strictEqual(execute(out.structure[5].calculation,0.25),1.25);const expected=clone(raw);expected.structure[5].calculation=out.structure[5].calculation;assert.deepStrictEqual(out,expected);});
test('compiled-container correction leaves every other tree and field unchanged',()=>{const f=fixture(5);f.apply();const out=f.readContainer(),expected=clone(f.compiled);expected.attributes[1].structure[5].calculation=out.attributes[1].structure[5].calculation;assert.deepStrictEqual(out,expected);});
test('unknown compiled baseline aborts before writing either linked resource',()=>{const f=fixture(5),bad=clone(f.compiled);bad.attributes[1].structure[5].calculation[4]=131072;f.write(f.input,bad);assert.throws(()=>f.apply(),/ursprüngliche Ausdauerformel/);assert(!fs.existsSync(f.output));});
test('repeated correction never compounds and does not rewrite stable output',()=>{const f=fixture(2),s=f.apply(),file=f.file(f.output,f.doc),first=fs.readFileSync(file),time=fs.statSync(file).mtimeMs;const second=f.apply();assert.strictEqual(second.filesChanged,0);assert.deepStrictEqual(fs.readFileSync(file),first);assert.strictEqual(fs.statSync(file).mtimeMs,time);f.verify(s);});
test('a previous corrected formula cannot masquerade as an original baseline',()=>{const f=fixture(1),patched=clone(f.doc);patched.structure[5].calculation=[131077,393215,0,393215,65536,851967,393215,131072,589823];f.write(f.input,patched);assert.throws(()=>f.apply(),/ursprüngliche Ausdauerformel/);assert(!fs.existsSync(f.output));});
test('off-target resource and alternate part remain byte-identical',()=>{const f=fixture(2),other=clone(f.doc),part=clone(f.doc);other.$guid='11111111-2222-3333-4444-555555555555';part.$part=1;f.write(f.input,other);f.write(f.input,part);const before=fs.readFileSync(f.file(f.input,other)),beforePart=fs.readFileSync(f.file(f.input,part));f.apply();assert.deepStrictEqual(fs.readFileSync(f.file(f.input,other)),before);assert.deepStrictEqual(fs.readFileSync(f.file(f.input,part)),beforePart);assert(!fs.existsSync(f.file(f.output,other)));assert(!fs.existsSync(f.file(f.output,part)));});
test('changed semantic ID, duplicate ID or unknown baseline fail closed',()=>{for(const mutate of [d=>d.ids[5].value++,d=>d.ids[4].value=d.ids[5].value,d=>d.debugNames[5]='Other',d=>d.structure[5].calculation[4]=131072,d=>d.structure[5].siblingIndex=7]){const f=fixture(2),bad=clone(f.doc);mutate(bad);f.write(f.input,bad);assert.throws(()=>f.apply(),/Attribut|Formel|Struktur/);assert(!fs.existsSync(f.output));}});
test('unknown command primitives or opcode schema fail before output',()=>{for(const mutate of [r=>r.types[5].primitiveType='FLOAT32',r=>r.types[8].enumFields.Clamp.value=15,r=>r.types[4].size=8]){const f=fixture(2);mutate(f.ref);assert.throws(()=>f.apply(),/Formelwort|Operator/);assert(!fs.existsSync(f.output));}});
test('a concurrent conflicting formula cannot be silently replaced',()=>{const f=fixture(2),bad=clone(f.doc);bad.structure[5].calculation.push(999);f.write(f.output,bad);const before=fs.readFileSync(f.file(f.output,bad));assert.throws(()=>f.apply(),/Konkurrierende/);assert.deepStrictEqual(fs.readFileSync(f.file(f.output,bad)),before);});
test('native readback rejects wrong output payload and self-modified proof',()=>{const f=fixture(2),s=f.apply(),bad=f.read();bad.structure[5].calculation[7]++;f.write(f.output,bad);assert.throws(()=>f.verify(s),/Archiv-Readback/);const g=fixture(2),proof=g.apply();proof.resources[0].expected[7]++;assert.throws(()=>g.verify(proof),/Prüfliste/);});
test('native readback rejects an unchanged compiled container despite corrected base',()=>{const f=fixture(5),s=f.apply();f.write(f.output,f.compiled);assert.throws(()=>f.verify(s),/Archiv-Readback/);});
test('input and output roots cannot alias',()=>{const f=fixture(2);assert.throws(()=>P.apply({config:f.config,reflection:f.ref},f.input,f.input),/getrennt/);});
const report={passed:true,checks:results.length,details:results,gameStarted:false,desktopStarted:false,liveArchivesModified:false};
fs.writeFileSync(path.join(__dirname,'player-values-results.json'),JSON.stringify(report,null,2));
// This script owns only the newly created small synthetic fixture directory.
const resolved=path.resolve(root),parent=path.resolve(__dirname,'..','..');
assert.strictEqual(path.dirname(resolved),parent);assert(path.basename(resolved).startsWith('player-value-tests-'));fs.rmSync(resolved,{recursive:true});
console.log(JSON.stringify({passed:true,checks:results.length,gameStarted:false,liveArchivesModified:false}));
