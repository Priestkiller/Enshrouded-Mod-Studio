'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),zlib=require('zlib');
const build=require('../engine/build-contract');
const source=role=>JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/native-schema-'+role+'.json.gz'))));
const copy=value=>JSON.parse(JSON.stringify(value));
const native={server:source('server'),client:source('client')};
let checks=0;
function test(name,run){run();checks++;}
function rejectsMutation(change,role='client'){
 const reflection=copy(native[role]);change(reflection);
 assert.throws(()=>build.compatibility(reflection,role),error=>error.actionCode==='game_schema_unsupported'&&error.mismatchDetails.gameFilesChanged===false);
}
const type=(reflection,name)=>{const value=reflection.types.find(type=>type.qualifiedName===name);assert(value,name);return value;};
test('Captured native profiles pass for their exact role',()=>{
 for(const role of ['server','client']){
  const proof=build.compatibility(native[role],role);
  assert.deepStrictEqual(Object.keys(proof).sort(),['profile','role','gameBuild','baselineBuild','schemaSha256','checked','typesChecked'].sort());
  assert.equal(proof.role,role);assert.equal(proof.checked,true);assert(proof.typesChecked>2000);
  assert.strictEqual(build.assertReflection(native[role],role),native[role]);
 }
});
test('New native build label passes only with unchanged layouts',()=>{
 for(const role of ['server','client']){
  const value=copy(native[role]);value.version='1285601|^/game38/branches/release_1.0|2026-11-03T10:13:01.005543Z';
  assert.equal(build.compatibility(value,role).gameBuild,value.version);
 }
});
test('Malformed build labels and a different release branch fail',()=>{
 for(const value of [null,'1283531','1283531|^/game38/branches/release_1.1|2026-10-30T09:15:50.868196Z',build.BUILD+'\n',build.BUILD.replace('2026-10-30','2026-02-30'),build.BUILD.replace('09:15:50','25:15:50')]){
  assert.equal(build.isBuildIdentity(value),false);assert.throws(()=>build.assertBuild(value),error=>error.actionCode==='game_build_unsupported');
 }
});
test('A version label alone and empty reflection are never proofs',()=>{
 for(const value of [{version:build.BUILD},{version:build.BUILD,types:[]}])assert.throws(()=>build.assertReflection(value,'client'),/Reflection/);
});
test('Extra unrelated types do not invalidate compatible native data',()=>{
 const reflection=copy(native.client);reflection.types.push({index:reflection.types.length,qualifiedName:'keen::UnrelatedNewTelemetryType',primitiveType:'STRUCT',size:0,alignment:1,elementAlignment:1,fieldCount:0,flags:'',qualifiedHash:42});
 assert.equal(build.compatibility(reflection,'client').checked,true);
});
test('Reflection index reorder is normalized by native qualified type identity',()=>{
 const reflection=copy(native.client),last=reflection.types.length-1;
 reflection.types=reflection.types.reverse();
 for(let index=0;index<reflection.types.length;index++){
  const row=reflection.types[index];row.index=index;
  if(Number.isInteger(row.innerType))row.innerType=last-row.innerType;
  for(const field of Object.values(row.structFields||{}))field.type=last-field.type;
 }
 assert.equal(build.compatibility(reflection,'client').checked,true);
});
test('Changed primitive width fails',()=>rejectsMutation(reflection=>type(reflection,'keen::uint16').size=4));
test('Changed field offset fails',()=>rejectsMutation(reflection=>type(reflection,'keen::ItemInfo').structFields.maxStackSize.dataOffset++));
test('Changed signedness/type fails',()=>rejectsMutation(reflection=>type(reflection,'keen::ItemInfo').structFields.maxStackSize.type=type(reflection,'keen::sint32').index));
test('Changed array element identity fails',()=>rejectsMutation(reflection=>{
 const array=reflection.types.find(row=>row.primitiveType==='BLOB_ARRAY'&&row.innerType!==type(reflection,'keen::uint16').index);
 assert(array);array.innerType=type(reflection,'keen::uint16').index;
}));
test('Changed enum mapping fails',()=>rejectsMutation(reflection=>{
 const row=reflection.types.find(row=>row.primitiveType==='ENUM'&&Object.keys(row.enumFields||{}).length>1);assert(row);
 Object.values(row.enumFields)[0].value++;
}));
test('Changed native default bytes fail',()=>rejectsMutation(reflection=>{
 const row=reflection.types.find(row=>Array.isArray(row.defaultValue)&&row.defaultValue.length);assert(row);row.defaultValue[0]^=1;
}));
test('Missing required type fails',()=>rejectsMutation(reflection=>type(reflection,'keen::ItemInfo').qualifiedName='keen::RemovedItemInfo'));
test('Duplicate native qualified name fails',()=>rejectsMutation(reflection=>{
 const row=copy(type(reflection,'keen::ItemInfo'));row.index=reflection.types.length;reflection.types.push(row);
}));
test('Invalid field and type indexes fail',()=>{
 rejectsMutation(reflection=>type(reflection,'keen::ItemInfo').structFields.maxStackSize.type=reflection.types.length);
 rejectsMutation(reflection=>type(reflection,'keen::ItemInfo').index++);
});
test('A server profile cannot stand in for the client profile',()=>assert.throws(()=>build.compatibility(native.server,'client'),error=>error.actionCode==='game_schema_unsupported'));
test('A larger unrelated variant census is accepted without granting new document types',()=>{
 const reflection=copy(native.client),variant=reflection.types.find(row=>row.primitiveType==='BLOB_VARIANT');assert(variant);variant.fieldCount++;
 assert.equal(build.compatibility(reflection,'client').checked,true);
 build.assertDocumentTypes({$type:'keen::ecs::TemplateResource',components:[{$type:'keen::ecs::Component'}]},'client');
 assert.throws(()=>build.assertDocumentTypes({$type:'keen::ecs::TemplateResource',components:[{$type:'keen::ecs::UnreviewedNewComponent'}]},'client'),error=>error.actionCode==='game_schema_unsupported');
});
test('Document depth and unknown archive roles are bounded',()=>{
 let document={};for(let index=0;index<100;index++)document={child:document};
 assert.throws(()=>build.assertDocumentTypes(document,'client'),/Strukturgrenze/);
 assert.throws(()=>build.compatibility(native.client,'other'),/Archivrolle/);
});
console.log(JSON.stringify({passed:true,checks,profile:build.PROFILE_ID,server:build.compatibility(native.server,'server'),client:build.compatibility(native.client,'client'),gameStarted:false,liveFilesWritten:false}));
