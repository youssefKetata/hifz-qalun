export function dateISO(date=new Date()) {const d=new Date(date.getTime()-date.getTimezoneOffset()*60000);return d.toISOString().slice(0,10)}
export function addDays(day,n){const d=new Date(`${day}T12:00:00`);d.setDate(d.getDate()+n);return dateISO(d)}
export function daysBetween(a,b){return Math.round((Date.parse(`${b}T12:00:00Z`)-Date.parse(`${a}T12:00:00Z`))/86400000)}
export const dueToday=(entry,day=dateISO())=> !entry.paused && (entry.nextDue||entry.created||day)<=day;
export function ratePassage(entry,rating,day=dateISO()){
  const age=Math.max(0,daysBetween(entry.created||day,day));
  const prior=Math.max(1,Number(entry.interval)||1);
  // Seven days of daily rehearsal for fresh passages.
  let next=1;
  if (rating==='hard') next=1;
  else if (age<7) next=1;
  else if (rating==='easy') next=Math.min(30,Math.max(2,Math.round(prior*1.9)));
  else next=Math.min(14,Math.max(2,Math.round(prior*1.25)));
  return {...entry,interval:next,nextDue:addDays(day,next),lastReviewed:day,
    reviews:[...(entry.reviews||[]),{date:day,rating}],
    ease:rating,hardCount:(entry.hardCount||0)+(rating==='hard'?1:0)};
}
export function pendingMistakes(mistakes,day=dateISO()){
  const yesterday=addDays(day,-1);
  return mistakes.filter(m=>!m.resolved && m.lastRevisited!==day && (m.date===yesterday || (m.nextDue||addDays(m.date,1))<=day))
    .sort((a,b)=>(a.nextDue||a.date).localeCompare(b.nextDue||b.date));
}
