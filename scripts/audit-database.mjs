import { initAdmin, envAdminEmails } from "./database-common.mjs";
const admin=initAdmin();
const db=admin.firestore();

const required=[
  ["system","settings"],
  ["system","winners_config"],
  ["system","home_layout"],
  ["public_config","marketing_tracking"],
  ["system_private","payonpag"],
  ["system_private","igamewin"],
  ["system_private","cpf_api"],
];
let failed=false;
for (const [c,id] of required) {
  const s=await db.collection(c).doc(id).get();
  console.log(`${s.exists?"PASS":"FAIL"} ${c}/${id}`);
  if(!s.exists) failed=true;
}
for(const email of envAdminEmails()){
  try{
    const u=await admin.auth().getUserByEmail(email);
    const s=await db.collection("users").doc(u.uid).get();
    const ok=s.exists && s.data()?.admin===true && s.data()?.role==="admin";
    console.log(`${ok?"PASS":"FAIL"} admin ${email}`);
    if(!ok) failed=true;
  }catch(e){
    console.log(`FAIL admin auth user ${email}: ${e?.code||e?.message}`);
    failed=true;
  }
}
process.exit(failed?1:0);
