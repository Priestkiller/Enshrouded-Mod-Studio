'use strict';
// Captured native schema metadata only; no game resources or executable code.
const fs=require('fs'),path=require('path'),zlib=require('zlib'),build=require('../engine/build-contract');
function reflection(role='server',version=build.BUILD){
 build.assertBuild(version);
 const value=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/native-schema-'+role+'.json.gz'))));
 value.version=version;return value;
}
function writeJob(job,version=build.BUILD){
 const value=reflection('server',version),proof=build.compatibility(value,'server');
 fs.mkdirSync(path.join(job,'bin'),{recursive:true});
 fs.writeFileSync(path.join(job,'bin/reflection_data.json'),JSON.stringify(value));
 return proof;
}
module.exports={reflection,writeJob};
