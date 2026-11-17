import test from 'node:test';
import assert from 'node:assert/strict';
import {readDraft, writeDraft} from '../src/useSessionDraft.ts';
test('refresh storage isolates sessions and preserves empty and zero answers', t => {
 const values=new Map();
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 writeDraft('session-one:survey',{page:2,answers:{credit:0,strategy:''}},storage);
 assert.deepEqual(readDraft('session-one:survey',null,storage),{page:2,answers:{credit:0,strategy:''}});
 assert.equal(readDraft('session-two:survey',null,storage),null);
 writeDraft(null,{preview:true},storage);assert.equal(values.size,1);
 values.set('study-v1:broken','invalid json');assert.equal(readDraft('broken','fallback',storage),'fallback');
});
test('unavailable browser storage does not interrupt the study',t=>{
 const storage={getItem(){throw new Error('Disabled');},setItem(){throw new Error('Full');}};
 assert.equal(readDraft('session','default',storage),'default');
 assert.doesNotThrow(()=>writeDraft('session','draft',storage));
});
