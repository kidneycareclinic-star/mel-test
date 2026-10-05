/* Bounded voice commands. Dictated clinical text is preserved, never interpreted as a tool. */
(function (root) {
  'use strict';
  function parse(input) {
    if (typeof input !== 'string' || !input.trim() || input.length > 4000) return {kind:'unknown'};
    var raw=input.trim().replace(/^(?:please|orchestrator)[,:]?\s+/i,''), command=raw.replace(/[.!?]+$/,'').trim();
    var add=raw.match(/^(?:add to (?:the )?plan|revise (?:the )?plan to add)\s*[:,]\s*([\s\S]+)$/i);
    if (add) return {kind:'edit',operation:'add',text:add[1].trim()};
    var replace=raw.match(/^replace in (?:the )?plan\s+["“]([^"”]+)["”]\s+with\s+["“]([^"”]+)["”][.!]?$/i);
    if (replace) return {kind:'edit',operation:'replace',find:replace[1],text:replace[2]};
    if (/\b(?:sign|finalize|approve|prescribe|send|release|delete)\b/i.test(command)) return {kind:'held'};
    if (/^(?:prepare|rebuild) (?:this|the) (?:visit|encounter)(?: using (?:(?:my|the) )?(?:nephrology )?soap(?: (?:note )?template)?)?$/i.test(command)) return {kind:'prepare',soap:/\bsoap\b/i.test(command)};
    var routes=[
      [/^(?:show (?:me )?what (?:still )?needs review|show (?:me )?(?:the )?(?:pending review|review checklist)|open (?:the )?review)$/i,'verification','review'],
      [/^(?:open|show)(?: me)? (?:the )?(?:proposed orders|draft orders|orders|draft actions)$/i,'orders','orders'],
      [/^(?:open|show)(?: me)? (?:the )?patient instructions$/i,'orders','instructions'],
      [/^(?:open|show)(?: me)? (?:the )?(?:note|soap note|nephrology note)$/i,'note','note'],
      [/^(?:open|show)(?: me)? (?:the )?(?:note template|templates|template and detail)$/i,'note','template'],
      [/^(?:open|show)(?: me)? (?:the )?(?:chart|labs)$/i,'chart','chart'],
      [/^(?:open|show)(?: me)? (?:the )?(?:evidence|guideline references)$/i,'evidence','evidence'],
      [/^(?:open|show)(?: me)? (?:the )?encounter inbox$/i,'followup','inbox'],
      [/^(?:open|show)(?: me)? (?:the )?phone alerts$/i,'followup','phone']
    ];
    for (var route of routes) if (route[0].test(command)) return {kind:'navigate',agent:route[1],target:route[2]};
    return {kind:'unknown'};
  }
  function proposal(note,command,headings) {
    if (typeof note!=='string'||command.kind!=='edit') throw Error('A current note draft is required.');
    var lines=note.split('\n'),position=0,starts=[],all=[];
    lines.forEach(function(line){
      var heading=line.trim().replace(/^#{1,6}\s*/,'').replace(/:$/,'').trim();
      if (/^(?:plan|recommendations|assessment (?:and|&) plan(?: by problem)?)$/i.test(heading)) starts.push({start:position+line.length,end:position+line.length+1});
      if (/^(?:subjective|objective|assessment|plan|history|hpi|physical examination|recommendations|follow[- ]up|patient instructions|assessment (?:and|&) plan(?: by problem)?)$/i.test(heading)||(headings||[]).some(function(h){return String(h).toLowerCase()===heading.toLowerCase();})) all.push(position);
      position+=line.length+1;
    });
    if(starts.length!==1) throw Error('A single Plan or Assessment and Plan heading is required. Open the note to edit this template.');
    var start=Math.min(note.length,starts[0].end),end=all.find(function(p){return p>=start;})??note.length;
    var before=note.slice(start,end),after;
    if(command.operation==='add') {
      if(!command.text?.trim()) throw Error('Dictate the text to add after “Add to plan:”.');
      after=before.replace(/\s*$/,'')+(before.trim()?'\n':'')+command.text+'\n'+(end<note.length?'\n':'');
    } else {
      var match=before.indexOf(command.find);
      if(!command.find||match<0||before.indexOf(command.find,match+1)>=0) throw Error('The quoted text must match exactly once in the plan. Open the note to edit it.');
      after=before.slice(0,match)+command.text+before.slice(match+command.find.length);
    }
    var next=note.slice(0,start)+(start===note.length?'\n':'')+after+note.slice(end);
    if(next.length>20000||after===before) throw Error('The proposal is unchanged or exceeds the note limit.');
    return {before:before,after:after,noteText:next};
  }
  root.ORCHESTRATOR_COMMANDS={parse:parse,proposal:proposal};
})(typeof window==='undefined'?globalThis:window);
