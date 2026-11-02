'use strict';
const assert=require('assert'),path=require('path');
const build=require('../engine/build-contract'),backend=require('../engine/studio-backend');
const defaults=require('../assets/defaults.json');
let checks=0;
for(const value of [null,'1283531','1273043|^/game38/branches/release_1.0|2026-10-20T14:55:29.904125Z','1283532|^/game38/branches/release_1.0|2026-10-30T09:15:50.868196Z',build.BUILD.replace('09:15:50','09:15:51')]){
 let messages=0;assert.throws(()=>backend.applyMods(defaults,path.join(__dirname,'missing-native-input'),path.join(__dirname,'missing-native-output'),()=>messages++,'server',{version:value,types:[]}),e=>e.actionCode==='game_build_unsupported'&&e.reason==='update_required'&&e.mismatchDetails.gameFilesChanged===false);assert.equal(messages,0,'Unknown builds must stop before the vendor processor is invoked');checks++;
}
assert.equal(build.assertBuild(build.BUILD),build.BUILD);checks++;
assert.equal(build.assertReflection({version:build.BUILD,types:[]}).version,build.BUILD);checks++;
assert.throws(()=>build.assertReflection({version:build.BUILD}),/Reflection/);checks++;
console.log(JSON.stringify({passed:true,checks,gameStarted:false,liveFilesWritten:false,vendorInvokedForUnsupportedBuild:false}));
