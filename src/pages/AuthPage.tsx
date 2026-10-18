import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Mail, UserRound, Phone } from 'lucide-react';
import { login, register, resetPassword } from '../lib/auth';
import '../auth-mobile.css';
import { getActiveReferralCode, normalizeAffiliateCode } from '../lib/affiliateTracking';

type Mode = 'login' | 'register' | 'forgot';

function firebaseMessage(error: any) {
  const code = String(error?.code || '');
  if(code==='invalid_credentials')return 'E-mail ou senha incorretos.';
  if(code==='email_not_confirmed')return 'Confirme seu e-mail antes de entrar.';
  if(code==='user_already_exists')return 'Este e-mail já possui uma conta.';
  if(code==='weak_password')return 'Sua senha não atende aos requisitos de segurança.';
  if(code==='over_request_rate_limit'||code==='over_email_send_rate_limit')return 'Muitas tentativas. Aguarde antes de tentar novamente.';
  if (code.includes('auth/email-already-in-use')) return 'Este e-mail já possui uma conta.';
  if (code.includes('auth/invalid-credential') || code.includes('auth/wrong-password')) return 'E-mail ou senha incorretos.';
  if (code.includes('auth/user-not-found')) return 'Não encontramos uma conta com este e-mail.';
  if (code.includes('auth/weak-password')) return 'Use uma senha com pelo menos 6 caracteres.';
  if (code.includes('auth/invalid-email')) return 'Informe um e-mail válido.';
  if (code.includes('auth/popup-closed-by-user')) return 'Login com Google cancelado.';
  if (code.includes('auth/popup-blocked')) return 'O navegador bloqueou a janela do Google. Permita popups e tente novamente.';
  if (code.includes('auth/too-many-requests')) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  return error?.message || 'Não foi possível concluir a operação.';
}

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState('');
  const [cpf, setCpf] = useState('');
  const [referralCode, setReferralCode] = useState(() => getActiveReferralCode());
  const isRegister = mode === 'register';
  const isForgot = mode === 'forgot';

  useEffect(() => {
    const activeRef = getActiveReferralCode();
    if (activeRef && !referralCode) {
      setReferralCode(activeRef);
    }
  }, []);

  function formatCpf(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    return digits
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1-$2');
  }

  function formatPhone(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 10) {
      return digits
        .replace(/^(\d{2})(\d)/, '($1) $2')
        .replace(/(\d{4})(\d)/, '$1-$2');
    }
    return digits
      .replace(/^(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{5})(\d)/, '$1-$2');
  }


  function changeMode(next: Mode) {
    setMode(next);
    setError('');
    setNotice('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);

    try {
      if (mode === 'login') {
        await login(email, password, remember);
        return;
      }

      if (mode === 'forgot') {
        await resetPassword(email);
        setNotice('Enviamos um link de recuperação para o seu e-mail.');
        return;
      }

      if (name.trim().length < 2) throw new Error('Informe seu nome completo.');
      const cpfDigits = cpf.replace(/\D/g, '');
      if (cpfDigits.length !== 11) throw new Error('Informe um CPF com exatamente 11 números.');
      const phoneDigits = phone.replace(/\D/g, '');
      if (phoneDigits.length < 10 || phoneDigits.length > 11) throw new Error('Informe um telefone válido com DDD.');
      if (password.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
      
      if (!adult) throw new Error('É necessário confirmar que você tem 18 anos ou mais.');
      if (!terms) throw new Error('Aceite os Termos de Uso e a Política de Privacidade.');

      const result = await register(name, email, password, { adult, terms }, {
        cpf: cpf.replace(/\D/g, ''),
        cpfValidated: false,
        phone: phone.replace(/\D/g, ''),
        referralCode: (referralCode.trim() ? normalizeAffiliateCode(referralCode) : getActiveReferralCode()) || undefined,
      });
      if ('needsEmailConfirmation' in result && result.needsEmailConfirmation) { setMode('login'); setNotice('Conta criada. Confirme seu e-mail para entrar.'); }
    } catch (e: any) {
      setError(firebaseMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`zb-auth ${isRegister ? 'zb-auth-register' : ''}`}>
      <div className="zb-auth-shell">
        <header className="zb-auth-hero">
          <img className="zb-auth-art" src={isRegister ? "/banners/auth-register-tiger.png?v=trevo-identidade-v1" : "/banners/auth-welcome-tiger.png?v=trevo-identidade-v1"} alt="" fetchPriority="high" />
          <div className="zb-auth-hero-shade" />
          <div className="zb-auth-brand"><img className="zb-auth-logo" src="/brand/trevo-da-sorte-logo.svg" alt="Trevo da Sorte"/><small>18+</small></div>
          <div className="zb-auth-welcome">
            <h1>{isForgot ? <>RECUPERE<br/><strong>SEU ACESSO.</strong></> : isRegister ? <>BEM-VINDO À<br/><strong>TREVO DA SORTE!</strong></> : <>BEM-VINDO<br/><strong>NOVAMENTE!</strong></>}</h1>
            <p>{isForgot ? 'Estamos aqui para ajudar.' : isRegister ? 'Sua experiência começa aqui.' : 'Bom ter você de volta.'}</p>
          </div>
        </header>
        <section className="zb-auth-panel" aria-labelledby="zb-auth-title">
          {isForgot && <button className="zb-auth-back" type="button" onClick={() => changeMode('login')}><ArrowLeft size={16}/> Voltar para o login</button>}
          <h2 id="zb-auth-title">{isForgot ? 'Recupere sua senha' : isRegister ? 'Crie sua conta' : 'Acesse sua conta'}</h2>
          <p className="zb-auth-description">{isForgot ? 'Enviaremos as instruções para seu e-mail.' : isRegister ? 'Comece em poucos passos.' : 'Entre na sua conta Trevo da Sorte.'}</p>
          <form onSubmit={submit} className="zb-auth-form">
            {isRegister && <label className="zb-auth-field"><span>Nome completo</span><div><UserRound size={19}/><input autoComplete="name" value={name} onChange={e=>setName(e.target.value)} placeholder="Digite seu nome completo" required minLength={2}/></div></label>}
            <label className="zb-auth-field"><span>E-mail</span><div><Mail size={19}/><input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Digite seu e-mail" required/></div></label>
            {isRegister && <>
              <label className="zb-auth-field"><span>Celular</span><div><Phone size={19}/><input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(formatPhone(e.target.value))} placeholder="(11) 91234-5678" maxLength={15} required/></div></label>
              <label className="zb-auth-field"><span>CPF</span><div><UserRound size={19}/><input inputMode="numeric" autoComplete="off" value={cpf} onChange={e=>setCpf(formatCpf(e.target.value))} placeholder="000.000.000-00" maxLength={14} required/></div></label>
            </>}
            {!isForgot && <label className="zb-auth-field"><span>Senha</span><div><LockKeyhole size={19}/><input type={showPassword?'text':'password'} autoComplete={isRegister?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder={isRegister?'Crie uma senha':'Digite sua senha'} minLength={isRegister?8:undefined} required/><button type="button" className="zb-auth-eye" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?'Ocultar senha':'Mostrar senha'}>{showPassword?<EyeOff size={20}/>:<Eye size={20}/>}</button></div>{isRegister && <small>Mínimo de 8 caracteres.</small>}</label>}
            {isRegister && <>
              {referralCode && <p className="zb-auth-referral">Link de parceiro ativo: <b>{referralCode}</b></p>}
              <label className="zb-auth-consent"><input type="checkbox" checked={adult&&terms} onChange={e=>{setAdult(e.target.checked);setTerms(e.target.checked);}} required/><span>Tenho <b>18 anos ou mais</b> e aceito os <span className="zb-auth-terms">Termos de Uso</span> e a Política de Privacidade.</span></label>
            </>}
            {mode==='login' && <div className="zb-auth-options"><label><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/><span>Lembrar de mim</span></label><button type="button" onClick={()=>changeMode('forgot')}>Esqueci minha senha</button></div>}
            {error && <div className="zb-auth-error" role="alert">{error}</div>}
            {notice && <div className="zb-auth-notice" role="status">{notice}</div>}
            <button type="submit" className="zb-auth-submit" disabled={busy}>{busy?'Aguarde…':isForgot?'Enviar link de recuperação':isRegister?'Criar minha conta':'Entrar na conta'}{!busy&&<ArrowRight size={19}/>}</button>
          </form>
          {!isForgot && <div className="zb-auth-switch">{isRegister?'Já tem conta?':'Não tem conta?'}<button type="button" onClick={()=>changeMode(isRegister?'login':'register')}>{isRegister?'Entrar':'Criar conta'}</button></div>}
          <footer className="zb-auth-footer">18+ · Jogue com responsabilidade.</footer>
        </section>
      </div>
    </main>
  );
}
