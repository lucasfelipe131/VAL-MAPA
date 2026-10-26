// Leitor mínimo de .xlsx (zip + SpreadsheetML) sem dependências.
// Cobre planilhas comuns: strings compartilhadas, strings inline, números e fórmulas com valor em cache.
import {inflateRawSync} from 'node:zlib'

function readZip(buffer){
 const files=new Map()
 const eocd=buffer.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]))
 if(eocd<0)throw new Error('Arquivo .xlsx inválido (sem diretório central).')
 const count=buffer.readUInt16LE(eocd+10);let offset=buffer.readUInt32LE(eocd+16)
 for(let i=0;i<count;i++){
  if(buffer.readUInt32LE(offset)!==0x02014b50)throw new Error('Arquivo .xlsx corrompido.')
  const method=buffer.readUInt16LE(offset+10);const compressed=buffer.readUInt32LE(offset+20);const nameLength=buffer.readUInt16LE(offset+28)
  const extraLength=buffer.readUInt16LE(offset+30);const commentLength=buffer.readUInt16LE(offset+32);const localOffset=buffer.readUInt32LE(offset+42)
  const name=buffer.toString('utf8',offset+46,offset+46+nameLength)
  const localNameLength=buffer.readUInt16LE(localOffset+26);const localExtraLength=buffer.readUInt16LE(localOffset+28)
  const dataStart=localOffset+30+localNameLength+localExtraLength
  const data=buffer.subarray(dataStart,dataStart+compressed)
  files.set(name,()=>method===8?inflateRawSync(data):method===0?Buffer.from(data):(()=>{throw new Error('Compressão não suportada no .xlsx.')})())
  offset+=46+nameLength+extraLength+commentLength
 }
 return files
}

const decode=value=>String(value).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').replace(/&#(\d+);/g,(_,code)=>String.fromCodePoint(Number(code)))
const textOf=xml=>decode([...xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map(match=>match[1]).join(''))
const columnIndex=ref=>{let index=0;for(const ch of ref.replace(/\d+/g,''))index=index*26+(ch.charCodeAt(0)-64);return index-1}

export function parseXlsx(buffer){
 const files=readZip(buffer)
 const read=name=>files.has(name)?files.get(name)().toString('utf8'):''
 const sharedStrings=[...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(match=>textOf(match[1]))
 const workbook=read('xl/workbook.xml')
 const rels=read('xl/_rels/workbook.xml.rels')
 const sheets=[...workbook.matchAll(/<sheet\s[^>]*?name="([^"]*)"[^>]*?r:id="([^"]*)"/g)].map(match=>{
  const target=(new RegExp(`<Relationship\\s[^>]*?Id="${match[2]}"[^>]*?Target="([^"]*)"`).exec(rels)||[])[1]||''
  return {name:decode(match[1]),path:target.startsWith('/')?target.slice(1):`xl/${target.replace(/^\.\//,'')}`}
 })
 const dateBase=/date1904="(1|true)"/.test(workbook)?Date.UTC(1904,0,1):Date.UTC(1899,11,30)
 return sheets.map(sheet=>{
  const xml=read(sheet.path);const rows=[]
  for(const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)){
   const rowNumber=Number((/\br="(\d+)"/.exec(rowMatch[1])||[])[1])||rows.length+1
   const cells=[]
   for(const cell of (rowMatch[2]||'').matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
    const attrs=cell[1];const inner=cell[2]||''
    const ref=(/r="([A-Z]+)\d+"/.exec(attrs)||[])[1];const type=(/t="([^"]+)"/.exec(attrs)||[])[1]
    const index=ref?columnIndex(ref):cells.length
    let value=null
    if(type==='s'){const raw=(/<v>([^<]*)<\/v>/.exec(inner)||[])[1];value=raw===undefined?null:sharedStrings[Number(raw)]??null}
    else if(type==='inlineStr')value=textOf(inner)
    else if(type==='str'||type==='e')value=decode((/<v>([^<]*)<\/v>/.exec(inner)||[])[1]??'')
    else if(type==='b')value=(/<v>([^<]*)<\/v>/.exec(inner)||[])[1]==='1'
    else{const raw=(/<v>([^<]*)<\/v>/.exec(inner)||[])[1];value=raw===undefined||raw===''?null:Number(raw)}
    cells[index]=value
   }
   while(rows.length<rowNumber-1)rows.push([])
   rows[rowNumber-1]=cells
  }
  return {name:sheet.name,rows,dateBase}
 })
}

export const excelSerialToDate=(serial,dateBase=Date.UTC(1899,11,30))=>new Date(dateBase+Math.round(Number(serial)*86_400_000))
