// Serialize refreshes and retain one follow-up when data changes during a request.
export function createRefreshQueue(load:()=>Promise<void>,onError:(error:unknown)=>void){
 let running=false,pending=false,stopped=false;
 async function drain(){
  running=true;
  try{while(pending&&!stopped){pending=false;try{await load();}catch(error){if(!stopped)onError(error);}}}
  finally{running=false;}
 }
 return {request(){if(stopped)return;pending=true;if(!running)void drain();},stop(){stopped=true;pending=false;}};
}
