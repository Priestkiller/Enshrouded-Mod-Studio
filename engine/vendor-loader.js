'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),v8=require('v8');
v8.setFlagsFromString('--no-lazy');v8.setFlagsFromString('--no-flush-bytecode');
const flags=new vm.Script('"studio"',{produceCachedData:true}).createCachedData().subarray(12,16);
function load(name,base=path.join(__dirname,'vendor'),cache=new Map()){
 name=name.replace(/\\/g,'/').replace(/\.js$/,'');
 if(name.split('/').includes('..'))throw Error('Ungültiger Modulpfad.');
 if(cache.has(name))return cache.get(name).exports;
 const filename=path.join(base,name+'.js.bytecode'),bytes=fs.readFileSync(filename);flags.copy(bytes,12);
 const length=bytes.readUInt32LE(8);if(length<2||length>2000000)throw Error('Ungültiges Bytecode-Modul.');
 const script=new vm.Script('"'+'\u200b'.repeat(length-2)+'"',{cachedData:bytes,filename:name+'.js'});
 if(script.cachedDataRejected)throw Error('Die mitgelieferte Engine-Runtime passt nicht zu den Modulen.');
 const mod={exports:{}};cache.set(name,mod);
 script.runInThisContext()(mod.exports,id=>id.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(name),id)),base,cache):require(id),mod,filename,path.dirname(filename));
 return mod.exports;
}
module.exports={load};
