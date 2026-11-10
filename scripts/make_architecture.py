"""Generate the README's self-contained SVG diagrams and editable Excalidraw source."""
from pathlib import Path
from html import escape
import re,json,hashlib,base64
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'docs/assets'
ASSETS.mkdir(parents=True,exist_ok=True)
BLUE='#45a8e7';GREEN='#48ad88';INK='#223346';GRAY='#68798b';VIOLET='#9374c4'
def text(x,y,value,size=14,color=GRAY,weight=400,anchor='start'):
    return f'<text x="{x}" y="{y}" fill="{color}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}" font-family="Inter,Segoe UI,Arial,sans-serif">{escape(value)}</text>'
def rect(x,y,w,h,fill='#fff',stroke='#dce5ec',r=16):return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}"/>'
def icon(name,x,y,w,h=None):
    source=(ASSETS/'logos'/f'{name}.svg').read_text(encoding='utf8') if name!='riften' else (ROOT/'public/favicon.svg').read_text()
    ET.register_namespace('', 'http://www.w3.org/2000/svg')
    ET.register_namespace('xlink','http://www.w3.org/1999/xlink')
    node=ET.fromstring(source)
    for key,value in {'x':x,'y':y,'width':w,'height':h or w}.items():node.set(key,str(value))
    return ET.tostring(node,encoding='unicode')

def edge(points,color=BLUE,both=False):return f'<path d="{points}" fill="none" stroke="{color}" stroke-width="2" stroke-linejoin="round" marker-end="url(#a{color[1:]})"'+(f' marker-start="url(#a{color[1:]})"' if both else '')+'/>'
def pill(x,y,value,color=GRAY):
    w=len(value)*7+22
    return rect(x-w/2,y-18,w,28,'#fff','#e9eef2',8)+text(x,y,value,12,color,500,'middle')
def start(w,h,title,subtitle):
    return f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="{escape(title)}"><title>{escape(title)}</title><defs>'+''.join(f'<marker id="a{c[1:]}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="{c}" stroke-width="1.8"/></marker>' for c in [BLUE,GREEN,VIOLET])+'</defs>'+rect(1,1,w-2,h-2,'#fcfeff','#e1e9ef',20)+text(40,49,title,25,INK,600)+text(40,77,subtitle,13)

svg=start(1280,780,'How Riften runs','React for the workspace. FastAPI for decisions. PostgreSQL for records. Nugen for model work.')
svg+=text(40,128,'WORKSPACE',11,BLUE,600)+text(480,128,'APPLICATION',11,BLUE,600)+text(920,128,'PERSISTENCE',11,GREEN,600)
for x,fill,stroke in [(40,'#f0f9ff','#c8e7fa'),(480,'#f0f9ff','#c8e7fa'),(920,'#f0fcf6','#c9ebdb')]:svg+=rect(x,150,320,170,fill,stroke)
svg+=icon('react',64,172,38)+icon('typescript',112,178,27)+text(64,241,'React workspace',20,INK,600)+text(64,272,'Compare versions. Inspect records.',13)+text(64,295,'Review a change without losing context.',13)
svg+=icon('python',504,174,34)+icon('fastapi',548,174,34)+text(504,241,'FastAPI backend',20,INK,600)+text(504,272,'Extract text, validate output, run rules.',13)+text(504,295,'Bounded tools. Explicit errors. Real IDs.',13)
svg+=icon('postgresql',944,172,40)+text(944,241,'PostgreSQL on Neon',20,INK,600)+text(944,272,'Versions, relationships, records and tasks.',13)+text(944,295,'Original document bytes live here too.',13)
svg+=rect(40,480,320,190,'#f0fcf6','#c9ebdb')+icon('riften',64,500,35)+text(64,565,'Review before execution',20,INK,600)+text(64,598,'Source passages stay attached.',13)+text(64,622,'A person approves the executable rule.',13)
svg+=rect(480,480,320,190,'#f6f2fd','#ded3f0')+icon('nugen',503,493,113,64)+text(504,580,'Nugen aligned model',20,INK,600)+text(504,610,'Upload → align → deploy → infer',13)+text(504,636,'Drafts are checked, failures are retained.',13)
svg+=rect(920,480,320,190,'#f0fcf6','#c9ebdb')+f'<circle cx="963" cy="518" r="18" fill="#d3f2e3"/><path d="m954 518 6 6 12-13" stroke="{GREEN}" stroke-width="3" fill="none"/>'+text(944,565,'Deterministic replay',20,INK,600)+text(944,598,'Approved conditions meet stored records.',13)+text(944,622,'Missing evidence remains unknown.',13)
svg+=edge('M360 235 H480',BLUE,True)+pill(420,215,'HTTPS / JSON')
svg+=edge('M800 235 H920',GREEN,True)+pill(860,215,'SQLAlchemy')
svg+=edge('M590 320 V480',VIOLET)+pill(570,399,'changed passages')
svg+=edge('M710 480 V320',VIOLET)+pill(754,438,'draft + evidence')
svg+=edge('M200 480 V320',GREEN)+pill(200,399,'review decision')
svg+=edge('M360 575 H420 V298 H480',GREEN)+pill(420,439,'approved condition')
svg+=edge('M800 298 H860 V575 H920',GREEN)+pill(860,399,'bounded rules')
svg+=edge('M1080 480 V320',GREEN)+pill(1080,439,'results + evidence')
svg+=icon('vercel',42,716,21)+text(76,733,'Hosted on Vercel Functions in Singapore. Public viewing, owner-only edits and model requests.',13)
svg+=text(40,757,'Solid arrows show implemented paths. In-process analysis is not a durable worker queue.',11,'#8491a0')+'</svg>'
(ASSETS/'architecture.svg').write_text(svg,encoding='utf8')

flow=start(1280,690,'One changed clause, all the way through','Eight visible steps. Stored inputs. Reproducible results. No claim that a model interpretation is binding law.')
steps=[(40,130,'01','Bring both versions',['Original files or an official URL.','Save the text, source and hash.'],'#edf8ff','#c7e6f7'),(350,130,'02','Extract and match',['Keep sections and page references.','Flag unreadable or repeated clauses.'],'#edf8ff','#c7e6f7'),(660,130,'03','Find the difference',['Align clause identifiers and wording.','Use stored embeddings when present.'],'#edf8ff','#c7e6f7'),(970,130,'04','Ask the aligned model',['Send changed passages to Nugen.','Keep its exact request and response.'],'#f5f0fc','#e0d3f1'),(970,415,'05','Check the draft',['Validate the schema and quotations.','Flag known source contradictions.'],'#f5f0fc','#e0d3f1'),(660,415,'06','Approve the condition',['Review scope, units and boundaries.','A person explicitly approves the rule.'],'#effbf5','#c9eadb'),(350,415,'07','Replay on stored records',['Follow verified dependency paths.','Keep unknown and unconnected results.'],'#effbf5','#c9eadb'),(40,415,'08','Turn impact into work',['Create linked tasks and add evidence.','Keep decisions and input snapshots.'],'#effbf5','#c9eadb')]
for x,y,num,title,lines,fill,stroke in steps:
    flow+=rect(x,y,270,160,fill,stroke)+text(x+19,y+30,num,12,BLUE if int(num)<4 else GREEN,600)+text(x+19,y+67,title,17,INK,600)
    flow+=text(x+19,y+102,lines[0],11)+text(x+19,y+126,lines[1],11)
for x in [310,620,930]:flow+=edge(f'M{x} 210 H{x+40}',BLUE)
flow+=edge('M1105 290 V415',VIOLET)+pill(1105,359,'structured output')
for x in [970,660,350]:flow+=edge(f'M{x} 495 H{x-40}',GREEN)
flow+=text(40,638,'The demo uses an authentic RBI annex and clearly labelled synthetic deposits. Current legal applicability still requires review.',12)
flow+='</svg>'
(ASSETS/'change-to-action.svg').write_text(flow,encoding='utf8')

# Editable scene with identical node geometry, labels and routed connectors.
elements=[];files={};index=0
def element(kind,x,y,w,h,**kw):
 global index
 index+=1;return {'id':f'riften-{index}','type':kind,'x':x,'y':y,'width':w,'height':h,'angle':0,'strokeColor':INK,'backgroundColor':'transparent','fillStyle':'solid','strokeWidth':1.5,'strokeStyle':'solid','roughness':0,'opacity':100,'groupIds':[],'frameId':None,'roundness':{'type':3} if kind=='rectangle' else None,'seed':index*7919,'version':1,'versionNonce':index*8123,'isDeleted':False,'boundElements':None,'updated':1,'link':None,'locked':False,**kw}
for x,y,num,title,lines,fill,stroke in steps:
 elements.append(element('rectangle',x,y,270,160,backgroundColor=fill,strokeColor=stroke))
 for yy,value,size in [(y+15,num,12),(y+48,title,17),(y+86,lines[0],11),(y+110,lines[1],11)]:elements.append(element('text',x+19,yy,236,size*1.5,text=value,originalText=value,fontSize=size,fontFamily=2,textAlign='left',verticalAlign='top',containerId=None,lineHeight=1.25,autoResize=True,baseline=size))
for x1,y1,x2,y2 in [(310,210,350,210),(620,210,660,210),(930,210,970,210),(1105,290,1105,415),(970,495,930,495),(660,495,620,495),(350,495,310,495)]:
 elements.append(element('arrow',min(x1,x2),min(y1,y2),abs(x2-x1),abs(y2-y1),strokeColor=BLUE if y1<300 else GREEN,points=[[x1-min(x1,x2),y1-min(y1,y2)],[x2-min(x1,x2),y2-min(y1,y2)]],startBinding=None,endBinding=None,startArrowhead=None,endArrowhead='arrow',elbowed=False))
for name,x,y,w,h in [('nugen',1135,137,90,45),('python',123,141,21,21),('fastapi',150,141,21,21)]:
 raw=(ASSETS/'logos'/f'{name}.svg').read_bytes();fid=hashlib.sha256(raw).hexdigest()[:40];files[fid]={'id':fid,'mimeType':'image/svg+xml','dataURL':'data:image/svg+xml;base64,'+base64.b64encode(raw).decode(),'created':1,'lastRetrieved':1};elements.append(element('image',x,y,w,h,fileId=fid,status='saved',scale=[1,1],crop=None))
(ROOT/'docs/architecture.excalidraw').write_text(json.dumps({'type':'excalidraw','version':2,'source':'https://excalidraw.com','elements':elements,'appState':{'viewBackgroundColor':'#fcfeff','gridSize':None},'files':files},indent=2),encoding='utf8')
print('Wrote two self-contained SVG diagrams and an editable Excalidraw scene.')
