#!/usr/bin/env python3
"""Read-only defensive FF row extraction diagnostic. No app scoring writes."""
import json, re, urllib.request, urllib.error
from html.parser import HTMLParser
from datetime import datetime, timezone

SOURCES = [
 ('FOX Carter game log', 'https://www.foxsports.com/nfl/barrett-carter-player-game-log?season=2026'),
 ('CBS Carter game log', 'https://www.cbssports.com/nfl/players/26701571/barrett-carter/game-log/'),
 ('CBS NFL team defensive season totals', 'https://www.cbssports.com/nfl/stats/team/team/defense/nfl/regular/'),
]
class Tables(HTMLParser):
 def __init__(self):
  super().__init__(); self.tables=[]; self.table=None; self.row=None; self.cell=None; self.depth=0
 def handle_starttag(self,tag,attrs):
  if tag=='table':
   if self.table is None: self.table=[]; self.depth=1
   else: self.depth+=1
  elif self.table is not None and tag=='tr': self.row=[]
  elif self.row is not None and tag in ('td','th'): self.cell=[]
 def handle_data(self,data):
  if self.cell is not None: self.cell.append(data)
 def handle_endtag(self,tag):
  if tag in ('td','th') and self.cell is not None and self.row is not None:
   self.row.append(' '.join(''.join(self.cell).split())); self.cell=None
  elif tag=='tr' and self.row is not None and self.table is not None:
   if self.row: self.table.append(self.row)
   self.row=None
  elif tag=='table' and self.table is not None:
   self.depth-=1
   if self.depth==0: self.tables.append(self.table); self.table=None

def relevant(row): return bool(re.search(r'\b(FF|FUM|FORCED FUMBLES|CARTER|CINCINNATI|NOV\s*1|11/1|ATL|FALCONS)\b',' '.join(row),re.I))
def probe(name,url):
 out={'source':name,'url':url,'checked_at_utc':datetime.now(timezone.utc).isoformat()}
 try:
  req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 (compatible; FantasyAudibleReadOnlyDiagnostic/1.0)','Accept':'text/html'})
  with urllib.request.urlopen(req,timeout=25) as resp:
   body=resp.read(4000000).decode('utf-8','replace'); out['http']=resp.status
  p=Tables(); p.feed(body); out['html_bytes']=len(body); out['tables_found']=len(p.tables)
  out['matching_tables']=[{'table_index':i,'rows':[{'row_index':j,'cells':row} for j,row in enumerate(t) if relevant(row)][:24], 'first_rows':[{'row_index':j,'cells':row} for j,row in enumerate(t[:4])]} for i,t in enumerate(p.tables) if any(relevant(row) for row in t)][:12]
  out['no_matching_tables']=not bool(out['matching_tables'])
  # Prevent false positive: merely finding FF and player name in page is not validation.
  out['verified_player_ff']=None
  out['verification_status']='REQUIRES_REVIEW_OF_ROW_AND_COLUMN_ALIGNMENT'
 except Exception as e: out['error']=str(e); out['verification_status']='FAILED_FETCH_OR_PARSE'
 return out
if __name__=='__main__':
 print(json.dumps({'purpose':'Verify exact player FF column and date, not just page keywords','sources':[probe(*s) for s in SOURCES]},indent=2))
