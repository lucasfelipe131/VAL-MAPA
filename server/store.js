// Persistência do VAL Geomap.
// PostgreSQL quando DATABASE_URL está definida (tabelas documentais com JSONB);
// fallback em arquivo JSON para desenvolvimento local.
import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import pg from 'pg'

export const collections=['producers','intents','market_refs','interactions','geo_links']
const tableFor=name=>`mapa_${name}`

export function createStore({databaseUrl,dataDir}){
 if(databaseUrl)return createPostgresStore(databaseUrl)
 return createJsonStore(dataDir)
}

function createPostgresStore(connectionString){
 const pool=new pg.Pool({connectionString,max:Number(process.env.PG_POOL_MAX||8),idleTimeoutMillis:30_000,connectionTimeoutMillis:8_000,ssl:/sslmode=require|railway|render|neon|supabase/i.test(connectionString)&&!/localhost|127\.0\.0\.1|railway\.internal/i.test(connectionString)?{rejectUnauthorized:false}:undefined})
 const row=r=>({id:r.id,...r.data,createdAt:r.created_at,updatedAt:r.updated_at})
 return {
  mode:'postgresql',
  async migrate(){
   const schema=fs.readFileSync(new URL('../database/schema.sql',import.meta.url),'utf8')
   await pool.query(schema)
  },
  async health(){try{await pool.query('SELECT 1');return {configured:true,ready:true,mode:'postgresql'}}catch{return {configured:true,ready:false,mode:'postgresql'}}},
  async all(name){const {rows}=await pool.query(`SELECT id,data,created_at,updated_at FROM ${tableFor(name)} ORDER BY created_at`);return rows.map(row)},
  async get(name,id){const {rows}=await pool.query(`SELECT id,data,created_at,updated_at FROM ${tableFor(name)} WHERE id=$1`,[id]);return rows[0]?row(rows[0]):null},
  async insert(name,data){const id=randomUUID();const {rows}=await pool.query(`INSERT INTO ${tableFor(name)} (id,data) VALUES ($1,$2::jsonb) RETURNING id,data,created_at,updated_at`,[id,JSON.stringify(data)]);return row(rows[0])},
  async update(name,id,data){const {rows}=await pool.query(`UPDATE ${tableFor(name)} SET data=$2::jsonb,updated_at=NOW() WHERE id=$1 RETURNING id,data,created_at,updated_at`,[id,JSON.stringify(data)]);return rows[0]?row(rows[0]):null},
  async remove(name,id){const {rowCount}=await pool.query(`DELETE FROM ${tableFor(name)} WHERE id=$1`,[id]);return rowCount>0},
  async removeWhere(name,field,value){const {rowCount}=await pool.query(`DELETE FROM ${tableFor(name)} WHERE data->>$1=$2`,[field,value]);return rowCount},
  async clear(){for(const name of collections)await pool.query(`DELETE FROM ${tableFor(name)}`);await pool.query('DELETE FROM mapa_documents')},
  // Documentos anexados (arquivo em bytea, fora do JSONB para não pesar nas listagens)
  files:{
   async put(meta,buffer){const id=randomUUID();const {rows}=await pool.query('INSERT INTO mapa_documents (id,producer_id,meta,content,size) VALUES ($1,$2,$3::jsonb,$4,$5) RETURNING id,producer_id,meta,size,created_at',[id,meta.producerId,JSON.stringify(meta),buffer,buffer.length]);return fileRow(rows[0])},
   async list(producerId){const {rows}=await pool.query('SELECT id,producer_id,meta,size,created_at FROM mapa_documents WHERE producer_id=$1 ORDER BY created_at DESC',[producerId]);return rows.map(fileRow)},
   async get(id){const {rows}=await pool.query('SELECT id,producer_id,meta,size,created_at,content FROM mapa_documents WHERE id=$1',[id]);return rows[0]?{...fileRow(rows[0]),content:rows[0].content}:null},
   async remove(id){const {rowCount}=await pool.query('DELETE FROM mapa_documents WHERE id=$1',[id]);return rowCount>0},
   async removeByProducer(producerId){const {rowCount}=await pool.query('DELETE FROM mapa_documents WHERE producer_id=$1',[producerId]);return rowCount}
  },
  close:()=>pool.end()
 }
}
const fileRow=r=>({...r.meta,id:r.id,producerId:r.producer_id,size:Number(r.size),createdAt:r.created_at})

function createJsonStore(dataDir){
 fs.mkdirSync(dataDir,{recursive:true})
 const file=path.join(dataDir,'mapa.json')
 const empty=()=>Object.fromEntries(collections.map(name=>[name,[]]))
 let db=empty()
 try{if(fs.existsSync(file))db={...empty(),...JSON.parse(fs.readFileSync(file,'utf8'))}}catch{db=empty()}
 const persist=()=>fs.writeFileSync(file,JSON.stringify(db,null,1))
 const now=()=>new Date().toISOString()
 const docDir=path.join(dataDir,'documentos'),docIndex=path.join(dataDir,'documentos.json')
 const readDocs=()=>{try{return JSON.parse(fs.readFileSync(docIndex,'utf8'))}catch{return []}}
 const writeDocs=all=>fs.writeFileSync(docIndex,JSON.stringify(all,null,1))
 return {
  mode:'json',
  async migrate(){persist()},
  async health(){return {configured:false,ready:true,mode:'json'}},
  async all(name){return db[name].map(item=>({...item}))},
  async get(name,id){const found=db[name].find(item=>item.id===id);return found?{...found}:null},
  async insert(name,data){const item={id:randomUUID(),...data,createdAt:now(),updatedAt:now()};db[name].push(item);persist();return {...item}},
  async update(name,id,data){const index=db[name].findIndex(item=>item.id===id);if(index<0)return null;db[name][index]={id,...data,createdAt:db[name][index].createdAt,updatedAt:now()};persist();return {...db[name][index]}},
  async remove(name,id){const before=db[name].length;db[name]=db[name].filter(item=>item.id!==id);persist();return db[name].length<before},
  async removeWhere(name,field,value){const before=db[name].length;db[name]=db[name].filter(item=>item[field]!==value);persist();return before-db[name].length},
  async clear(){db=empty();persist();fs.rmSync(docDir,{recursive:true,force:true});fs.rmSync(docIndex,{force:true})},
  // Documentos anexados: metadados em documentos.json, arquivo em .data/documentos/<id>
  files:{
   async put(meta,buffer){fs.mkdirSync(docDir,{recursive:true});const item={...meta,id:randomUUID(),size:buffer.length,createdAt:now()};fs.writeFileSync(path.join(docDir,item.id),buffer);const all=readDocs();all.push(item);writeDocs(all);return {...item}},
   async list(producerId){return readDocs().filter(d=>d.producerId===producerId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))},
   async get(id){const d=readDocs().find(x=>x.id===id);if(!d)return null;try{return {...d,content:fs.readFileSync(path.join(docDir,id))}}catch{return null}},
   async remove(id){const all=readDocs();const rest=all.filter(d=>d.id!==id);if(rest.length===all.length)return false;writeDocs(rest);fs.rmSync(path.join(docDir,id),{force:true});return true},
   async removeByProducer(producerId){const all=readDocs();const sai=all.filter(d=>d.producerId===producerId);writeDocs(all.filter(d=>d.producerId!==producerId));for(const d of sai)fs.rmSync(path.join(docDir,d.id),{force:true});return sai.length}
  },
  close:async()=>{}
 }
}
