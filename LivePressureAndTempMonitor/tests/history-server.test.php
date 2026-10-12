<?php
declare(strict_types=1);
require __DIR__ . '/../inc/job-history.php';
function check(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function rejects(callable $f, string $message): void { try { $f(); } catch (Throwable $e) { return; } throw new RuntimeException($message); }
$db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
history_schema($db);
$id = 'test-history-000001'; $writer = str_repeat('a', 64);
$owner = ['id'=>$id, 'writer'=>$writer];
$claim = history_write($db, 'claim', $owner); check($claim['revision'] === 0, 'Claim');
rejects(fn()=>history_write($db,'claim',['id'=>$id,'writer'=>str_repeat('b',64)]), 'Wrong device cannot overwrite');
$data = json_encode([['at'=>1000,'pressure'=>984],['at'=>2000,'pressure'=>985]]); $hash = hash('sha256',$data);
history_write($db,'chunk',$owner+['hash'=>$hash,'data'=>$data]);
history_write($db,'chunk',$owner+['hash'=>$hash,'data'=>$data]);
check((int)$db->query('SELECT COUNT(*) FROM hydro_job_chunks')->fetchColumn()===1,'Retry deduplicates');
$metadata = ['test'=>['jobNumber'=>'Example', 'slot'=>'A'], 'archivedAt'=>0];
$manifest = ['readings'=>[$hash], 'temperatureReadings'=>[]];
$result = history_write($db,'commit',$owner+['revision'=>0,'metadata'=>$metadata,'manifest'=>$manifest]);
check($result['revision']===1,'Commit');
rejects(fn()=>history_write($db,'commit',$owner+['revision'=>0,'metadata'=>$metadata,'manifest'=>$manifest]),'Stale revision rejected');
rejects(fn()=>history_write($db,'commit',$owner+['revision'=>1,'metadata'=>$metadata,'manifest'=>['readings'=>[str_repeat('f',64)],'temperatureReadings'=>[]]]),'Incomplete upload rejected');
check((int)history_get($db,$id)['revision']===1,'Failed upload preserves previous snapshot');
rejects(fn()=>history_write($db,'chunk',$owner+['data'=>$data,'hash'=>str_repeat('c',64)]),'Checksum mismatch rejected');
$metadata['archivedAt']=3000;
history_write($db,'commit',$owner+['revision'=>1,'metadata'=>$metadata,'manifest'=>$manifest]);
$metadata['archivedAt']=0;
rejects(fn()=>history_write($db,'commit',$owner+['revision'=>2,'metadata'=>$metadata,'manifest'=>$manifest]),'Cannot reopen archive');
check(json_decode(history_get($db,$id)['manifest_json'],true)===$manifest,'Full archive remains readable');
// Any signed-in host can organize; no recording-device writer key is required.
$before = history_get($db,$id);
history_manage($db,'rename',['id'=>$id,'version'=>0,'value'=>'Line D — Section 2']);
history_manage($db,'move',['id'=>$id,'version'=>1,'value'=>'Atmos 2026']);
rejects(fn()=>history_manage($db,'rename',['id'=>$id,'version'=>0,'value'=>'Stale edit']),'Stale phone edit rejected');
rejects(fn()=>history_manage($db,'rename',['id'=>$id,'version'=>2,'value'=>'  ']),'Blank name rejected');
rejects(fn()=>history_manage($db,'move',['id'=>$id,'version'=>2,'value'=>str_repeat('a',161)]),'Long folder rejected');
rejects(fn()=>history_manage($db,'rename',['id'=>$id,'version'=>2,'value'=>['bad']]),'Non-string rejected');
history_manage($db,'trash',['id'=>$id,'version'=>2]);
$metadata['archivedAt']=3000;
history_write($db,'commit',$owner+['revision'=>2,'metadata'=>$metadata,'manifest'=>$manifest]);
$managed=history_list($db)[0];
check($managed['label']==='Line D — Section 2' && $managed['folder']==='Atmos 2026' && (int)$managed['deleted_at']>0,'Auto-upload cannot undo rename/move/Trash');
check((int)$managed['organization_version']===3,'Upload does not change organization version');
check(history_get($db,$id)['metadata_json']===$before['metadata_json'],'Original paperwork unchanged');
check(history_get($db,$id)['manifest_json']===$before['manifest_json'],'Readings unchanged by organizing');
history_manage($db,'restore',['id'=>$id,'version'=>3]);
check((int)history_list($db)[0]['deleted_at']===0,'Restore retains complete recording');
history_manage($db,'move',['id'=>$id,'version'=>4,'value'=>'']);
check(history_list($db)[0]['folder']==='','Move to Unfiled');
history_schema($db); check(history_list($db)[0]['label']==='Line D — Section 2','Schema rerun preserves organization');
// Authentication format tests use test-only secrets and do not touch live config.
$testConfig=['host_password'=>'fixture-host','db_password'=>'fixture-db'];
function app_config(string $key): mixed { global $testConfig; return $testConfig[$key] ?? null; }
function is_host_signed_in(): bool { return !empty($_SESSION['pressure_host_authenticated']); }
function csrf_token(): string { return $_SESSION['pressure_csrf'] ?? str_repeat('c',48); }
require __DIR__ . '/../inc/persistent-auth.php';
$body=base64_encode(json_encode(['expires'=>time()+10000,'csrf'=>str_repeat('c',48)]));
$cookie=$body.'.'.hash_hmac('sha256',$body,host_remember_key());
check(host_remember_decode($cookie)!==null,'Valid trusted device');
check(host_remember_decode($cookie.'0')===null,'Tampering rejected');
$testConfig['host_password']='changed'; check(host_remember_decode($cookie)===null,'Password rotation rejects old cookie');
$body=base64_encode(json_encode(['expires'=>time()-10,'csrf'=>str_repeat('c',48)]));
check(host_remember_decode($body.'.'.hash_hmac('sha256',$body,host_remember_key()))===null,'Expired cookie rejected');
echo "History database: retry deduplication, complete manifests, stale writer/revision rejection, archived protection and trusted-cookie verification passed.\n";
