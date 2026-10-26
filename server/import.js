// Importação de produtores a partir de CSV ou XLSX: detecção do cabeçalho,
// mapeamento de colunas em português e preenchimento de valores padrão.
import {parseXlsx,excelSerialToDate} from './xlsx.js'
import {domainError} from './rules.js'

const slug=value=>String(value??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const headerMap=[
 [/^(nome|produtor|nome do produtor|cliente|razao social|name)$/,'name'],
 [/^(municipio|cidade|municipality)$/,'municipality'],
 [/^(uf|estado|state)$/,'uf'],
 [/^(regiao|região|region|microrregiao|unidade|filial)$/,'region'],
 [/^(latitude|lat)$/,'lat'],
 [/^(longitude|lng|lon|long)$/,'lng'],
 [/^(area|area ha|area hectares|hectares|area total|area em hectares|area em ha|ha)$/,'areaHa'],
 [/^(culturas?|cultivo|commodity|grao|graos)$/,'cultures'],
 [/^(produtividade|expectativa de produtividade|produtividade sc ha|expectativa de produtividade sacas ha|sacas ha|sc ha|produtividade esperada)$/,'productivityScHa'],
 [/^(producao|producao em sacas|producao sacas|volume sacas|volume estimado sc|sacas|potencial sacas|potencial em sacas|producao estimada)$/,'estimatedVolumeSc'],
 [/^(volume|volume estimado|volume estimado t|potencial|potencial t|producao t|toneladas)$/,'estimatedVolumeT'],
 [/^(armazenagem sc|armazenagem sacas|capacidade sc)$/,'storageCapacitySc'],
 [/^(armazenagem|armazenagem t|capacidade de armazenagem|silo)$/,'storageCapacityT'],
 [/^(unidade|unidade volume|unidade de volume)$/,'volumeUnit'],
 [/^(relacionamento|status|relacao|situacao)$/,'relationship'],
 [/^(consultor|responsavel|vendedor|rtv|tecnico)$/,'consultant'],
 [/^(telefone|celular|fone|whatsapp|contato)$/,'phone'],
 [/^(ultimo contato|data do ultimo contato|ultima visita)$/,'lastContactAt'],
 [/^(observacoes|observacao|notas|obs)$/,'notes'],
 [/^(safra|ano safra|season)$/,'season'],
 [/^(cif)$/,'cif'],[/^(fob)$/,'fob'],[/^(frete|modalidade|logistica)$/,'freight'],
 [/^(id|codigo|chave|external key|matricula)$/,'externalKey']
]
const relationshipAlias={prospecto:'prospect',prospect:'prospect','em contato':'contact',contato:'contact',ativo:'active','cliente ativo':'active',cliente:'active',parceiro:'partner',partner:'partner',inativo:'inactive',inactive:'inactive'}
const mapHeader=cell=>{const key=slug(cell);if(!key)return null;for(const [pattern,field] of headerMap)if(pattern.test(key))return field;return null}

function parseCsv(text){
 const delimiter=(text.match(/;/g)||[]).length>=(text.match(/,/g)||[]).length?';':','
 const rows=[];let row=[];let cell='';let quoted=false
 for(let i=0;i<text.length;i++){
  const ch=text[i]
  if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++}else if(ch==='"')quoted=false;else cell+=ch}
  else if(ch==='"')quoted=true
  else if(ch===delimiter){row.push(cell);cell=''}
  else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell=''}
  else cell+=ch
 }
 if(cell||row.length){row.push(cell);rows.push(row)}
 return rows
}

// Converte uma matriz de células em linhas de produtor. O cabeçalho é a primeira linha
// que contenha uma coluna de nome e pelo menos outra coluna reconhecida.
export function rowsToProducers(matrix,defaults={},options={}){
 const headerIndex=matrix.findIndex(row=>{const fields=(row||[]).map(mapHeader);return fields.includes('name')&&fields.filter(Boolean).length>=2})
 if(headerIndex<0)throw domainError('Não encontrei um cabeçalho com a coluna do produtor (nome) e outras colunas reconhecidas.')
 const fields=(matrix[headerIndex]||[]).map(mapHeader)
 const producers=[];const skipped=[]
 for(let r=headerIndex+1;r<matrix.length;r++){
  const row=matrix[r]||[];const record={}
  fields.forEach((field,index)=>{if(!field)return;const value=row[index];if(value===null||value===undefined||String(value).trim()==='')return;record[field]=value})
  if(!record.name||!String(record.name).trim()){if(row.some(cell=>cell!==null&&cell!==undefined&&String(cell).trim()!==''&&String(cell).trim()!=='0'))skipped.push(r+1);continue}
  if(record.lastContactAt!==undefined&&typeof record.lastContactAt==='number')record.lastContactAt=excelSerialToDate(record.lastContactAt,options.dateBase).toISOString()
  if(record.relationship)record.relationship=relationshipAlias[slug(record.relationship)]||record.relationship
  const cif=record.cif!==undefined&&String(record.cif).trim()!=='';const fob=record.fob!==undefined&&String(record.fob).trim()!==''
  if(cif||fob)record.freight=cif&&fob?'both':cif?'cif':'fob'
  delete record.cif;delete record.fob
  const merged={...defaults,...record}
  if(options.externalKeyPrefix&&!merged.externalKey)merged.externalKey=`${options.externalKeyPrefix}:${slug(merged.name).replace(/\s+/g,'-')}`
  producers.push(merged)
 }
 return {producers,headerLine:headerIndex+1,fields:fields.filter(Boolean),skipped}
}

export function parseImportFile({filename='',buffer,defaults={},externalKeyPrefix=''}){
 const lower=String(filename).toLowerCase()
 if(lower.endsWith('.xlsx')||buffer.subarray(0,2).toString('latin1')==='PK'){
  const sheets=parseXlsx(buffer);if(!sheets.length)throw domainError('A planilha não tem abas.')
  const sheet=sheets.find(item=>item.rows.length)||sheets[0]
  return {sheet:sheet.name,...rowsToProducers(sheet.rows,defaults,{dateBase:sheet.dateBase,externalKeyPrefix})}
 }
 const text=buffer.toString('utf8').replace(/^﻿/,'')
 return {sheet:null,...rowsToProducers(parseCsv(text),defaults,{externalKeyPrefix})}
}
