<?php
declare(strict_types=1);
// Execute the real endpoint against an isolated in-memory database. Only MySQL's
// locking/upsert syntax is adapted for SQLite; a live MySQL smoke test is still required.
final class ResponseSent extends Exception { public function __construct(public array $body, public int $status) { parent::__construct('response'); } }
final class FixtureDb {
    public PDO $pdo;
    public function __construct() { $this->pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]); }
    public function prepare(string $sql): PDOStatement {
        $sql = str_replace(' FOR UPDATE', '', $sql);
        $sql = str_replace('ON DUPLICATE KEY UPDATE source_id = VALUES(source_id)', 'ON CONFLICT(source_id,captured_at) DO NOTHING', $sql);
        return $this->pdo->prepare($sql);
    }
    public function query(string $sql): PDOStatement { return $this->pdo->query($sql); }
    public function exec(string $sql): int|false { return $this->pdo->exec($sql); }
    public function beginTransaction(): bool { return $this->pdo->beginTransaction(); }
    public function commit(): bool { return $this->pdo->commit(); }
    public function rollBack(): bool { return $this->pdo->rollBack(); }
    public function inTransaction(): bool { return $this->pdo->inTransaction(); }
}
function db(): FixtureDb { return $GLOBALS['fixture']; }
function json_input(): array { return $GLOBALS['input']; }
function require_host(): void { if ($GLOBALS['scenario'] === 'signed-out') json_response(['error'=>'Sign in'],401); }
function require_csrf(): void { if ($GLOBALS['scenario'] === 'csrf') json_response(['error'=>'CSRF'],403); }
function json_response(array $body, int $status=200): never { throw new ResponseSent($body,$status); }
function random_hex(int $bytes): string { return bin2hex(random_bytes($bytes)); }
function base_url(): string { return 'https://grantgsolutions.com/hydro/'; }
function check(bool $ok,string $message): void { if (!$ok) throw new RuntimeException($message); }
$scenario = $argv[1] ?? 'fresh'; $fixture = new FixtureDb();
$fixture->pdo->exec('CREATE TABLE live_sessions (id TEXT PRIMARY KEY,publisher_token_hash TEXT,viewer_password_hash TEXT);
CREATE TABLE temperature_devices (id TEXT PRIMARY KEY,serial TEXT,token_hash TEXT,active INTEGER DEFAULT 1,ready INTEGER,last_seen_at INTEGER,source_id TEXT,created_at INTEGER);
CREATE TABLE temperature_device_power (device_id TEXT PRIMARY KEY,battery_percent INTEGER,on_ac INTEGER,charging INTEGER,has_battery INTEGER,laptop_temp_f INTEGER,reported_at INTEGER);
CREATE TABLE temperature_device_power_log (device_id TEXT,reported_at INTEGER,battery_percent INTEGER,on_ac INTEGER,PRIMARY KEY(device_id,reported_at));
CREATE TABLE temperature_sources (id TEXT PRIMARY KEY,session_id TEXT,slot TEXT,serial TEXT,token_hash TEXT,active INTEGER,sample_interval_seconds INTEGER,whole_degrees INTEGER,created_at INTEGER);
CREATE TABLE temperature_device_runs (source_id TEXT PRIMARY KEY,device_id TEXT,stopped_at INTEGER);
CREATE TABLE temperature_readings (id INTEGER PRIMARY KEY AUTOINCREMENT,source_id TEXT,session_id TEXT,slot TEXT,captured_at INTEGER,received_at INTEGER,pipe REAL,soil REAL,ambient REAL,aux REAL,UNIQUE(source_id,captured_at));');
$session = str_repeat('a',16); $oldSession=str_repeat('b',16); $device=str_repeat('c',16); $old=str_repeat('d',16); $new=str_repeat('e',16); $token=str_repeat('f',64);
$now=(int)round(microtime(true)*1000);
foreach ([$session,$oldSession] as $id) $fixture->prepare('INSERT INTO live_sessions VALUES (?,?,?)')->execute([$id,hash('sha256',$token),'']);
$fixture->prepare('INSERT INTO temperature_devices VALUES (?,?,?,?,?,?,?,?)')->execute([$device,'TEST',hash('sha256',$token),1,1,$now,null,$now-100000]);
$input=['session_id'=>$session,'publish_token'=>$token,'slot'=>'A','device_id'=>$device,'sample_interval_seconds'=>10,'whole_degrees'=>true];
$_GET['action']='connect_device'; $_SERVER['REQUEST_METHOD']='POST';
$hasOld=!in_array($scenario,['fresh','signed-out','csrf','wrong-publisher','offline'],true);
$stopped=in_array($scenario,['finishing','complete-old','closed-ingest','pre-start','post-stop','wrong-device','duplicate'],true);
if ($hasOld) {
    $own=in_array($scenario,['resume','stop'],true);
    $fixture->prepare('INSERT INTO temperature_sources VALUES (?,?,?,?,?,?,?,?,?)')->execute([$old,$own?$session:$oldSession,$own?'A':'B','TEST',hash('sha256',$token),$stopped?0:1,10,1,$now-60000]);
    $fixture->prepare('INSERT INTO temperature_device_runs VALUES (?,?,?)')->execute([$old,$device,$stopped?$now-30000:null]);
    $fixture->prepare('UPDATE temperature_devices SET source_id=?')->execute([$old]);
}
if ($scenario==='transfer'||$scenario==='changed-assignment') { $input['replace_recording']=true;$input['expected_source_id']=$scenario==='transfer'?$old:$new; }
if ($scenario==='wrong-publisher') $input['publish_token']=str_repeat('0',64);
if ($scenario==='offline') $fixture->pdo->exec('UPDATE temperature_devices SET ready=0');
if ($scenario==='stop') $_GET['action']='disconnect_device';
if (in_array($scenario,['complete-old','closed-ingest','pre-start','post-stop','wrong-device','duplicate'],true)) {
    $fixture->prepare('INSERT INTO temperature_sources VALUES (?,?,?,?,?,?,?,?,?)')->execute([$new,$session,'A','TEST',hash('sha256',$token),1,2,0,$now-10000]);
    $fixture->prepare('INSERT INTO temperature_device_runs VALUES (?,?,NULL)')->execute([$new,$device]);
    $fixture->prepare('UPDATE temperature_devices SET source_id=?')->execute([$new]);
    $_GET['action']=$scenario==='complete-old'?'device_complete':'device_ingest';
    $at=$scenario==='pre-start'?$now-60001:($scenario==='post-stop'?$now-29999:$now-45000);
    $input=['device_id'=>$device,'device_token'=>$token,'source_id'=>$old,'serial'=>'TEST','samples'=>[['at'=>$at,'pipe'=>70.9]]];
    if ($scenario==='wrong-device') $fixture->prepare('UPDATE temperature_device_runs SET device_id=? WHERE source_id=?')->execute([$new,$old]);
    if ($scenario==='duplicate') $fixture->prepare('INSERT INTO temperature_readings (source_id,session_id,slot,captured_at,pipe) VALUES (?,?,?,?,?)')->execute([$old,$oldSession,'B',$now-50000,65]);
}
$code=file_get_contents(__DIR__.'/../temperature.php');
$code=str_replace("__DIR__ . '/inc/field-power.php'", var_export(realpath(__DIR__.'/../inc/field-power.php'),true),$code);
if ($scenario==='heartbeat-power') {
    $_GET['action']='device_heartbeat';
    $input=['device_id'=>$device,'device_token'=>$token,'serial'=>'TEST','ready'=>true,
        'power'=>['battery_percent'=>84,'on_ac'=>true,'charging'=>true,'has_battery'=>true]];
}
if ($scenario==='reissue') { $_GET['action']='reissue_device'; $input=['device_id'=>$device]; }
if ($scenario==='list-power') {
    $_GET['action']='list_devices';
    $fixture->prepare('INSERT INTO temperature_device_power VALUES (?,?,?,?,?,?,?)')->execute([$device,84,1,1,1,null,$now]);
    $fixture->prepare('INSERT INTO temperature_device_power_log VALUES (?,?,?,?)')->execute([$device,$now-60000,85,0]);
}
$code=str_replace(["<?php", "declare(strict_types=1);", "require __DIR__ . '/inc/bootstrap.php';"], '', $code);
try { eval($code); throw new RuntimeException('Endpoint did not return a response'); }
catch (ResponseSent $response) {
    $expected=match($scenario) {'signed-out'=>401,'csrf','wrong-publisher','wrong-device'=>403,'occupied','changed-assignment','offline'=>409,'pre-start','post-stop'=>400,default=>200};
    check($response->status===$expected,"$scenario: expected HTTP $expected, got {$response->status}");
    $assigned=$fixture->query('SELECT source_id FROM temperature_devices')->fetchColumn();
    if($scenario==='heartbeat-power') check($fixture->query('SELECT battery_percent FROM temperature_device_power')->fetchColumn()===84,'Heartbeat stores power');
    if($scenario==='heartbeat-power') check($fixture->query('SELECT battery_percent FROM temperature_device_power_log')->fetchColumn()===84,'Heartbeat logs battery history');
    if($scenario==='list-power') check($response->body['devices'][0]['power']['battery_percent']===84 && $response->body['devices'][0]['power']['charging']===true,'Host receives power');
    if($scenario==='list-power') { $history=$response->body['devices'][0]['power']['history']; check(count($history)===1 && $history[0]['percent']===85 && $history[0]['on_ac']===false,'Host receives battery history'); }
    if($scenario==='reissue') {
        $settings=$response->body['settings'];
        check($settings['device_id']===$device && $settings['serial']==='TEST' && $settings['website']==='https://grantgsolutions.com/hydro' && preg_match('/^[a-f0-9]{64}$/',$settings['device_token'])===1,'Setup file has the same logger ID, a new token and the site address');
        $hash=$fixture->query('SELECT token_hash FROM temperature_devices')->fetchColumn();
        check($hash===hash('sha256',$settings['device_token']) && $hash!==hash('sha256',$token),'New token works; the old laptop key no longer does');
    }
    if(in_array($scenario,['fresh','finishing','transfer'],true)) {
        check($assigned!==null&&$assigned!==$old,'New source assigned');
        $run=$fixture->query("SELECT * FROM temperature_sources WHERE id='$assigned'")->fetch();
        check($run['created_at'] >= $now && $run['slot']==='A' && $run['sample_interval_seconds']===10 && $run['whole_degrees']===1,'New window begins now with selected options');
    }
    if($scenario==='transfer') check($fixture->query("SELECT stopped_at FROM temperature_device_runs WHERE source_id='$old'")->fetchColumn()>=$now,'Old run closes at transfer');
    if($scenario==='resume') check($assigned===$old && $response->body['resumed']===true && $fixture->query('SELECT COUNT(*) FROM temperature_sources')->fetchColumn()===1,'Repeated start is idempotent');
    if($scenario==='occupied'||$scenario==='changed-assignment') check($assigned===$old&&$fixture->query("SELECT active FROM temperature_sources WHERE id='$old'")->fetchColumn()===1,'No unconfirmed takeover');
    if($scenario==='stop') check($fixture->query("SELECT stopped_at FROM temperature_device_runs WHERE source_id='$old'")->fetchColumn()>=$now,'Stop saves boundary');
    if($scenario==='complete-old') check($assigned===$new,'Old completion cannot clear newer assignment');
    if($scenario==='closed-ingest'||$scenario==='duplicate') {
        $rows=$fixture->query('SELECT * FROM temperature_readings')->fetchAll();
        check(count($rows)===1&&$rows[0]['source_id']===$old&&$rows[0]['slot']==='B','Backlog stays in original window/test');
        check((float)$rows[0]['pipe']===($scenario==='duplicate'?65.0:71.0),'Rounding and retry deduplication');
    }
    if(in_array($scenario,['pre-start','post-stop','wrong-device'],true)) check($fixture->query('SELECT COUNT(*) FROM temperature_readings')->fetchColumn()===0,'Rejected sample cannot write data');
    echo "Temperature endpoint passed: $scenario\n";
}
