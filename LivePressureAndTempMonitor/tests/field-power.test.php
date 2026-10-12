<?php
declare(strict_types=1);
require __DIR__.'/../inc/field-power.php';
$fixture = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
function db(): PDO { return $GLOBALS['fixture']; }
function check(bool $ok): void { if (!$ok) throw new RuntimeException('Power telemetry assertion failed'); }
check(list_field_power() === []); // Before first upgraded bridge connects.
$fixture->exec('CREATE TABLE temperature_device_power(device_id TEXT PRIMARY KEY,battery_percent INTEGER,on_ac INTEGER,charging INTEGER,has_battery INTEGER,reported_at INTEGER)');
save_field_power('test', ['battery_percent'=>84,'on_ac'=>true,'charging'=>true,'has_battery'=>true],100);
check(list_field_power()['test'] === ['battery_percent'=>84,'reported_at'=>100,'on_ac'=>true,'charging'=>true,'has_battery'=>true,'laptop_temp_f'=>null]);
save_field_power('test', ['battery_percent'=>84,'on_ac'=>true,'charging'=>true,'has_battery'=>true,'laptop_temp_f'=>142],150); // Old table gains the column.
check(list_field_power()['test']['laptop_temp_f']===142 && list_field_power()['test']['battery_percent']===84);
foreach ([0, 400, '150', 150.5] as $bad) { save_field_power('test', ['laptop_temp_f'=>$bad],160); check(list_field_power()['test']['laptop_temp_f']===null); }
save_field_power('test', null,200);check(list_field_power()['test']['reported_at']===160);
save_field_power('test', ['battery_percent'=>0,'on_ac'=>false,'charging'=>false,'has_battery'=>true],300);
check(list_field_power()['test']['battery_percent']===0 && list_field_power()['test']['on_ac']===false);
save_field_power('test', ['battery_percent'=>255,'on_ac'=>'true','charging'=>1,'has_battery'=>true],400);
check(list_field_power()['test']['battery_percent']===null && list_field_power()['test']['on_ac']===null && list_field_power()['test']['charging']===null);
save_field_power('test', ['battery_percent'=>100,'on_ac'=>true,'charging'=>true,'has_battery'=>false],500);
check(list_field_power()['test']['battery_percent']===null && list_field_power()['test']['charging']===false);
$fixture->exec('CREATE TABLE temperature_device_power_log(device_id TEXT,reported_at INTEGER,battery_percent INTEGER,on_ac INTEGER,PRIMARY KEY(device_id,reported_at))');
foreach ([[1000,100,true],[6000,100,false],[11000,100,false],[16000,99,false],[21000,99,false],[26000,null,null],[31000,98,true]] as [$at,$pct,$ac])
    save_field_power('log', ['battery_percent'=>$pct,'on_ac'=>$ac,'charging'=>false,'has_battery'=>true],$at);
$history=list_field_power_history(0)['log'];
check(array_column($history,'at')===[1000,6000,16000,31000]); // Only changes; unknown readings skipped.
check($history[1]===['at'=>6000,'percent'=>100,'on_ac'=>false]);
check(array_column(list_field_power_history(10000)['log'],'at')===[16000,31000]);
save_field_power('log', ['battery_percent'=>97,'on_ac'=>true,'has_battery'=>true],31000+31*86400000);
check(array_column(list_field_power_history(0)['log'],'at')===[31000+31*86400000]); // Older than 30 days pruned.
echo "Power storage passed: validation, old bridge, unknown values, no battery, zero battery, laptop temperature and column upgrade, battery history.\n";
