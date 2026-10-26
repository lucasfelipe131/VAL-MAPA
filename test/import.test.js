import test from 'node:test'
import assert from 'node:assert/strict'
import {deflateRawSync} from 'node:zlib'
import {parseXlsx} from '../server/xlsx.js'
import {rowsToProducers,parseImportFile} from '../server/import.js'
import {normalizeProducer} from '../server/rules.js'

// Monta um .xlsx mínimo em memória (zip com entradas deflate) para testar o leitor sem dependências.
function crc32(buffer){let c,crc=0xffffffff;for(let i=0;i<buffer.length;i++){c=(crc^buffer[i])&0xff;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crc=(crc>>>8)^c}return (crc^0xffffffff)>>>0}
function zip(entries){
 const locals=[];const centrals=[];let offset=0
 for(const [name,content] of Object.entries(entries)){
  const raw=Buffer.from(content,'utf8');const data=deflateRawSync(raw);const nameBuffer=Buffer.from(name)
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc32(raw),14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(nameBuffer.length,26)
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc32(raw),16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(nameBuffer.length,28);central.writeUInt32LE(offset,42)
  locals.push(local,nameBuffer,data);centrals.push(central,nameBuffer);offset+=local.length+nameBuffer.length+data.length
 }
 const centralStart=offset;const centralBuffer=Buffer.concat(centrals)
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(Object.keys(entries).length,8);end.writeUInt16LE(Object.keys(entries).length,10);end.writeUInt32LE(centralBuffer.length,12);end.writeUInt32LE(centralStart,16)
 return Buffer.concat([...locals,centralBuffer,end])
}
const workbook=zip({
 'xl/workbook.xml':'<workbook xmlns:r="r"><sheets><sheet name="Planilha1" sheetId="1" r:id="rId1"/></sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>',
 'xl/sharedStrings.xml':'<sst><si><t>Levantamento da Área de milho 26/27</t></si><si><t>Produtor</t></si><si><t>Área hectares</t></si><si><t>Expectativa de Produtividade Sacas/há</t></si><si><t>Produção em Sacas</t></si><si><t>CIF</t></si><si><t>FOB</t></si><si><t>Maria &amp; Filhos</t></si><si><t>x</t></si></sst>',
 'xl/worksheets/sheet1.xml':'<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"/><row r="4"><c r="A4" t="s"><v>1</v></c><c r="B4" t="s"><v>2</v></c><c r="C4" t="s"><v>3</v></c><c r="D4" t="s"><v>4</v></c><c r="E4" t="s"><v>5</v></c><c r="F4" t="s"><v>6</v></c></row><row r="5"><c r="A5" t="s"><v>7</v></c><c r="B5"><v>180</v></c><c r="C5"><v>180</v></c><c r="D5"><f>B5*C5</f><v>32400</v></c><c r="E5" t="s"><v>8</v></c></row><row r="6"><c r="A6" t="inlineStr"><is><t>João Linha</t></is></c><c r="B6"><v>1000</v></c><c r="C6"><v>170</v></c><c r="D6"><v>170000</v></c><c r="F6" t="s"><v>8</v></c></row><row r="7"><c r="D7"><v>0</v></c></row></sheetData></worksheet>'
})

test('parseXlsx lê strings compartilhadas, inline e números',()=>{
 const [sheet]=parseXlsx(workbook)
 assert.equal(sheet.name,'Planilha1')
 assert.equal(sheet.rows[0][0],'Levantamento da Área de milho 26/27')
 assert.equal(sheet.rows[3][0],'Produtor')
 assert.equal(sheet.rows[4][0],'Maria & Filhos')
 assert.equal(sheet.rows[4][3],32400)
 assert.equal(sheet.rows[5][0],'João Linha')
})

test('rowsToProducers detecta o cabeçalho, mapeia colunas em português e aplica padrões',()=>{
 const [sheet]=parseXlsx(workbook)
 const result=rowsToProducers(sheet.rows,{municipality:'São Luiz Gonzaga',uf:'RS',cultures:'milho'},{externalKeyPrefix:'lote'})
 assert.equal(result.headerLine,4)
 assert.deepEqual(result.fields,['name','areaHa','productivityScHa','estimatedVolumeSc','cif','fob'])
 assert.equal(result.producers.length,2)
 assert.equal(result.producers[0].freight,'cif')
 assert.equal(result.producers[1].freight,'fob')
 assert.equal(result.producers[0].externalKey,'lote:maria-filhos')
 const producer=normalizeProducer(result.producers[0])
 assert.equal(producer.municipality,'São Luiz Gonzaga');assert.deepEqual(producer.cultures,['milho'])
 assert.equal(producer.estimatedVolumeT,1944);assert.equal(producer.volumeUnit,'sc');assert.equal(producer.productivityScHa,180)
})

test('parseImportFile aceita CSV e deriva volume de área × produtividade',()=>{
 const csv='nome;municipio;uf;area_ha;produtividade\nFazenda A;Ijuí;RS;100;150\n'
 const result=parseImportFile({filename:'lista.csv',buffer:Buffer.from(csv)})
 assert.equal(result.producers.length,1)
 const producer=normalizeProducer(result.producers[0])
 assert.equal(producer.estimatedVolumeT,900)
 assert.throws(()=>parseImportFile({filename:'x.csv',buffer:Buffer.from('a;b\n1;2\n')}),/cabeçalho/)
})
