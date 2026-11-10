// C包独立联调预览：不更改正式server、API或01/02公共工作台。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { algorithms } from '../shared/algorithms/final/c/index.js';

export function createCPreviewServer() {
  const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  return createServer(async(req,res)=>{
    try{
      const path=new URL(req.url,'http://127.0.0.1').pathname;
      if(req.method==='GET'&&path==='/api/algorithms')return send(res,200,Object.entries(algorithms).map(([id,a])=>({id,title:a.title,example:a.example})));
      if(req.method==='POST'&&path==='/api/run'){
        let size=0;const chunks=[];
        for await(const c of req){size+=c.length;if(size>10240)throw new TypeError('请求体最多10KB');chunks.push(c);}
        const {algorithm,input}=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(typeof algorithm!=='string'||!Object.hasOwn(algorithms,algorithm))return send(res,404,{error:'算法不存在'});
        return send(res,200,{runId:randomUUID(),algorithm,...algorithms[algorithm].generate(input)});
      }
      const files={'/':['./final-c-preview.html','text/html'],'/playback.js':['../frontend/src/features/playback/index.js','text/javascript']};
      if(req.method==='GET'&&Object.hasOwn(files,path)){
        const [file,type]=files[path];res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});return res.end(await readFile(new URL(file,import.meta.url)));
      }
      return send(res,404,{error:'不存在的预览地址'});
    }catch(error){return send(res,error instanceof TypeError||error instanceof SyntaxError?400:500,{error:error.message});}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const port=Number(process.env.PORT??3106);
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error('PORT无效');
  const server=createCPreviewServer();
  server.listen(port,'127.0.0.1',()=>console.log(`C包联调预览：http://127.0.0.1:${server.address().port}`));
  server.on('error',e=>{console.error(e.message);process.exitCode=1;});
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close());
}
