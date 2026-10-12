/* Read-only log sampling. Values are recorded samples, never interpolated or averaged. */
(function (root) {
  'use strict';
  const KEYS = ['pressure', 'ambient', 'pipe', 'soil', 'aux'];
  const valid = value => typeof value === 'number' && Number.isFinite(value);
  function prepare(record) {
    const series = Object.fromEntries(KEYS.map(key => [key, []]));
    for (const [rows, keys] of [[record.readings || [], ['pressure']], [record.temperatureReadings || [], KEYS.slice(1)]]) {
      for (const row of rows) {
        if (!valid(row.at)) continue;
        for (const key of keys) if (valid(row[key])) series[key].push({at:row.at, value:row[key], source:row.source});
      }
    }
    const limits = {};
    for (const key of KEYS) {
      series[key].sort((a,b)=>a.at-b.at);
      const deltas = [];
      for (let i=1;i<Math.min(series[key].length,2000);i++) {
        const delta=series[key][i].at-series[key][i-1].at;
        if (delta>0) deltas.push(delta);
      }
      deltas.sort((a,b)=>a-b);
      // Field logger interval is at most 60 seconds. Never span an outage or
      // extrapolate an isolated/manual sample over a long stretch of time.
      limits[key] = key === 'pressure' ? 30000 : Math.max(30000,Math.min(65000,(deltas[Math.floor(deltas.length/2)] || 0)+5000));
    }
    const populated=Object.values(series).filter(rows=>rows.length);
    return { series, limits, start:populated.length ? Math.min(...populated.map(rows=>rows[0].at)) : null,
      end:populated.length ? Math.max(...populated.map(rows=>rows.at(-1).at)) : null };
  }
  function nearest(rows, at, tolerance, start, end) {
    let low=0, high=rows.length;
    while(low<high) { const mid=(low+high)>>>1; if(rows[mid].at<at) low=mid+1; else high=mid; }
    let best=null;
    for(const row of [rows[low-1],rows[low]]) {
      if (!row || row.at<start || row.at>end) continue;
      const allowed = ['manual','sheet'].includes(row.source) ? 30000 : tolerance;
      if (Math.abs(row.at-at)>allowed) continue;
      if (!best || Math.abs(row.at-at)<Math.abs(best.at-at)) best=row;
    }
    return best;
  }
  function plan(data, {interval=900000,period='all',testStart=0,testEnd=0}={}) {
    let start=data.start, end=data.end;
    if (start===null || end===null) return {count:0, reason:'No pressure or temperature readings were saved.'};
    if (period!=='all') {
      if (!valid(testStart) || testStart<=0) return {count:0,reason:'No official test start was entered. Choose Entire recording.'};
      if (period==='official') { start=Math.max(start,testStart); if(testEnd>0) end=Math.min(end,testEnd); }
      else end=Math.min(end,testStart-1);
    }
    if (end<start) return {count:0,reason:'No readings fall within this period.'};
    const step=Math.max(1000,Math.round(Number(interval)||900000));
    // Exact range endpoints plus clock-aligned intervals. Pagination does not
    // discard older samples, even for several days of one-second records.
    const first=(Math.floor(start/step)+1)*step;
    const middle=Math.max(0,Math.ceil((end-first)/step));
    const count=1+middle+(end>start?1:0);
    return {start,end,count,at(index) {
      if(index<0 || index>=count) throw new RangeError('Log row is outside the selected period.');
      return index===0 ? start : index===count-1 ? end : first+(index-1)*step;
    },row(index) {
      const at=this.at(index), values={};
      for(const key of KEYS) values[key]=nearest(data.series[key],at,data.limits[key],start,end);
      return {at,values};
    }};
  }
  const api={prepare,plan};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.HydroHistoryLog=api;
})(globalThis);
