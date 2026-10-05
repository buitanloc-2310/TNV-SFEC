import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function ui(){
 const nodes=Object.fromEntries(['opportunitySearch','opportunityGrid','opportunityCount','unitGrid','unitCount'].map(id=>['#'+id,{value:'',innerHTML:'',textContent:''}]));
 const filters=['all','class','training','activity','event'].map(filter=>({dataset:{filter},attributes:{},classList:{toggle(){}},setAttribute(k,v){this.attributes[k]=v}}));
 const c=vm.createContext({$:s=>nodes[s],$$:()=>filters,Intl,Date});
 const esc=source.slice(source.indexOf('function esc('),source.indexOf('function fmt('));
 const render=source.slice(source.indexOf('function renderOpportunities('),source.indexOf('function showDetail('));
 vm.runInContext(`let currentFilter='all';const typeNames={class:'Lớp học',activity:'Cộng đồng'};const opportunities=[{id:1,type:'class',title:'Dạy tiếng Anh',unit_name:'Giáo dục',description:'Dạy học'},{id:2,type:'activity',title:'<script>alert(1)</script>',unit_name:'Cộng đồng',description:'Đồng hành'}];const units=[{code:'TEST',name:'Đơn vị thử',description:'Mô tả'}];function fmt(){return '—'};${esc}${render}`,c);
 return {nodes,filters,run:s=>vm.runInContext(s,c)};
}
test('search combines keyword and type; count and filter state agree',()=>{const u=ui();u.nodes['#opportunitySearch'].value='Giáo dục';u.run("renderOpportunities('class')");assert.equal(u.nodes['#opportunityCount'].textContent,'1 cơ hội phù hợp');assert.match(u.nodes['#opportunityGrid'].innerHTML,/Dạy tiếng Anh/);assert.equal(u.filters[1].attributes['aria-pressed'],'true');u.run("renderOpportunities('activity')");assert.equal(u.nodes['#opportunityCount'].textContent,'0 cơ hội phù hợp');assert.match(u.nodes['#opportunityGrid'].innerHTML,/Chưa có cơ hội phù hợp/)});
test('card content escapes HTML from opportunity data',()=>{const u=ui();u.run('renderOpportunities()');assert.doesNotMatch(u.nodes['#opportunityGrid'].innerHTML,/<script>/);assert.match(u.nodes['#opportunityGrid'].innerHTML,/&lt;script&gt;/)});
test('unit count comes from actual data',()=>{const u=ui();u.run('renderUnits()');assert.equal(u.nodes['#unitCount'].textContent,'1 đơn vị đang hoạt động');assert.match(u.nodes['#unitGrid'].innerHTML,/Đơn vị thử/)});
