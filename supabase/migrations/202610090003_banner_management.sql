begin;
alter table public.banner_campaigns
 add column if not exists presentation jsonb not null default '{}';

create or replace function public.zerobet_manage_banner(
 p_operation text, p_id uuid default null, p_patch jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 current_row public.banner_campaigns;
 data jsonb;
 result_id uuid;
 title_value text;
 image_value text;
 candidate_url text;
 active_value boolean;
 start_value timestamptz;
 end_value timestamptz;
begin
 if not zerobet_private.is_admin() then
  raise exception 'Acesso administrativo obrigatório' using errcode='42501';
 end if;
 if p_operation is null or p_operation not in ('CREATE','UPDATE','DELETE','DUPLICATE') then
  raise exception 'Operação inválida' using errcode='22023';
 end if;
 if p_patch is null or jsonb_typeof(p_patch)<>'object' or octet_length(p_patch::text)>32768 then
  raise exception 'Configuração inválida' using errcode='22023';
 end if;
 if p_operation<>'CREATE' then
  select * into current_row from public.banner_campaigns where id=p_id for update;
  if not found then raise exception 'Banner não encontrado' using errcode='P0002'; end if;
 end if;
 if p_operation='DELETE' then
  delete from public.banner_campaigns where id=p_id;
  result_id:=p_id;
 else
  if p_operation='CREATE' then data:=p_patch;
  else
   data:=current_row.presentation || jsonb_build_object(
    'title',current_row.title,'placement',current_row.placement,
    'active',current_row.active,'sortOrder',current_row.position,
    'action',current_row.action,'targeting',current_row.targeting,
    'desktopImage',coalesce(current_row.presentation->>'desktopImage',current_row.image_path),
    'mobileImage',coalesce(current_row.presentation->>'mobileImage',current_row.image_path)
   ) || p_patch;
  end if;
  if p_operation='DUPLICATE' then
   data:=data || jsonb_build_object('active',false,'status','DRAFT',
    'title',left(coalesce(data->>'title','Banner'),150)||' (cópia)',
    'name',left(coalesce(data->>'name','Banner'),150)||' (cópia)');
  end if;
  title_value:=coalesce(nullif(btrim(data->>'title'),''),nullif(btrim(data->>'name'),''));
  if title_value is null or length(title_value)>160 then
   raise exception 'Informe um título ou nome com até 160 caracteres' using errcode='22023';
  end if;
  image_value:=coalesce(nullif(data->>'desktopImage',''),nullif(data->>'mobileImage',''));
  if image_value is null then raise exception 'Selecione uma imagem para o banner' using errcode='22023'; end if;
  if image_value !~* '^(https?://|/[^/])' or image_value ~ '[[:cntrl:]\\]' then
   raise exception 'URL da imagem inválida' using errcode='22023';
  end if;
  if coalesce(data#>>'{action,url}','')<>'' and ((data#>>'{action,url}') !~* '^(https?://|/[^/])' or (data#>>'{action,url}') ~ '[[:cntrl:]\\]') then
   raise exception 'URL da ação inválida' using errcode='22023';
  end if;
  foreach candidate_url in array array[data->>'desktopImage',data->>'mobileImage'] loop
   if coalesce(candidate_url,'')<>'' and (candidate_url !~* '^(https?://|/[^/])' or candidate_url ~ '[[:cntrl:]\\]') then
    raise exception 'URL da imagem inválida' using errcode='22023';
   end if;
  end loop;
  active_value:=coalesce((data->>'active')::boolean,false);
  data:=data || jsonb_build_object('status',case when active_value then 'ACTIVE' when data->>'status'='DRAFT' then 'DRAFT' else 'PAUSED' end);
  start_value:=nullif(data#>>'{schedule,startsAt}','')::timestamptz;
  end_value:=nullif(data#>>'{schedule,endsAt}','')::timestamptz;
  if start_value is not null and end_value is not null and end_value<=start_value then
   raise exception 'Período de publicação inválido' using errcode='22023';
  end if;
  if p_operation in ('CREATE','DUPLICATE') then
   insert into public.banner_campaigns(title,placement,image_path,active,position,action,targeting,starts_at,ends_at,presentation)
   values(title_value,coalesce(nullif(data->>'placement',''),'HOME_TOP'),image_value,active_value,
    coalesce((data->>'sortOrder')::integer,0),coalesce(data->'action','{}'::jsonb),coalesce(data->'targeting','{}'::jsonb),start_value,end_value,data)
   returning id into result_id;
  else
   update public.banner_campaigns set title=title_value,placement=coalesce(nullif(data->>'placement',''),'HOME_TOP'),
    image_path=image_value,active=active_value,position=coalesce((data->>'sortOrder')::integer,0),
    action=coalesce(data->'action','{}'::jsonb),targeting=coalesce(data->'targeting','{}'::jsonb),
    starts_at=start_value,ends_at=end_value,presentation=data
   where id=p_id returning id into result_id;
  end if;
 end if;
 insert into public.admin_audit_logs(actor_id,action,target_id,metadata)
 values(auth.uid(),'BANNER_'||p_operation,result_id::text,jsonb_build_object('bannerId',result_id));
 return jsonb_build_object('id',result_id);
end;
$$;
revoke all on function public.zerobet_manage_banner(text,uuid,jsonb) from public,anon;
grant execute on function public.zerobet_manage_banner(text,uuid,jsonb) to authenticated;
commit;
