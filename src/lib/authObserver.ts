/** Auth token rotation must not restart UI authorization for the same identity. */
export function createDistinctAuthObserver<T>(identity:(value:T)=>string, notify:(value:T)=>void) {
  let previous:string|undefined;
  return (value:T)=>{
    const next=identity(value);
    if(previous===next)return;
    previous=next;
    notify(value);
  };
}
