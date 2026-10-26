import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {mergeMesh,municipalityMesh,slugName} from '../server/malhas.js'

const mesh={type:'FeatureCollection',features:[{type:'Feature',properties:{codarea:'4318705'},geometry:{type:'Polygon',coordinates:[[[-55,-28.3],[-54.9,-28.3],[-54.9,-28.5],[-55,-28.5],[-55,-28.3]]]}},{type:'Feature',properties:{codarea:'4310207'},geometry:{type:'Polygon',coordinates:[[[-54,-28],[-53.9,-28],[-53.9,-28.1],[-54,-28.1],[-54,-28]]]}}]}
const names=[{id:4318705,nome:'São Luiz Gonzaga'},{id:4310207,nome:'Ijuí'}]

test('mergeMesh une geometria e nomes por código IBGE',()=>{
 const merged=mergeMesh('RS',mesh,names)
 assert.equal(merged.features.length,2)
 assert.equal(merged.features[0].properties.name,'São Luiz Gonzaga')
 assert.equal(merged.features[0].properties.slug,'sao luiz gonzaga')
 assert.equal(slugName('IJUÍ'),'ijui')
})

test('municipalityMesh usa a fetch injetada e grava cache em disco',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'malhas-'))
 const calls=[]
 const fetchImpl=async url=>{calls.push(url);if(url.includes('githubusercontent'))return {ok:false,status:404};return {ok:true,json:async()=>url.includes('/malhas/')?mesh:names}}
 const first=await municipalityMesh('sc',{fetchImpl,dataDir:dir})
 assert.equal(first.uf,'SC');assert.equal(first.features.length,2);assert.equal(calls.length,3,'GitHub primeiro, depois as duas APIs do IBGE')
 assert.ok(fs.existsSync(path.join(dir,'malhas','SC.json')))
 const second=await municipalityMesh('SC',{fetchImpl,dataDir:dir})
 assert.equal(calls.length,3,'segunda chamada vem do cache')
 assert.equal(second.features[1].properties.name,'Ijuí')
 await assert.rejects(()=>municipalityMesh('Rio',{fetchImpl,dataDir:dir}),/UF inválida/)
})

test('municipalityMesh prefere a malha do GitHub e o arquivo embarcado',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'malhas-'))
 const github={type:'FeatureCollection',features:[{type:'Feature',properties:{id:'4318903',name:'São Luiz Gonzaga'},geometry:mesh.features[0].geometry}]}
 const fetchImpl=async url=>({ok:url.includes('githubusercontent'),status:500,json:async()=>github})
 const data=await municipalityMesh('PR',{fetchImpl,dataDir:dir})
 assert.equal(data.features[0].properties.slug,'sao luiz gonzaga');assert.match(data.source,/geodata-br/)
 const bundledDir=path.join(dir,'bundled');fs.mkdirSync(bundledDir);fs.writeFileSync(path.join(bundledDir,'MT.json'),JSON.stringify({type:'FeatureCollection',uf:'MT',features:[{type:'Feature',properties:{code:'1',name:'Sorriso',slug:'sorriso'},geometry:mesh.features[1].geometry}]}))
 const bundled=await municipalityMesh('MT',{fetchImpl:async()=>{throw new Error('sem rede')},dataDir:dir,bundledDir})
 assert.equal(bundled.features[0].properties.name,'Sorriso')
 await assert.rejects(()=>municipalityMesh('GO',{fetchImpl:async()=>{throw new Error('sem rede')},dataDir:dir}),/indisponível/)
})
