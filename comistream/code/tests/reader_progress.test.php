<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/lib/lib_reader_input.php';
require_once dirname(__DIR__) . '/lib/lib_reader_progress.php';
function expectProgress(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
function progressFixture(string $format = 'archive', bool $read = false): array {
    $db = new PDO('sqlite::memory:'); $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $schema = file_get_contents(dirname(__DIR__, 2) . '/rsrc/sql/make-comistream-db-ddl.sql');
    $db->exec(substr($schema, 0, strpos($schema, 'CREATE TABLE IF NOT EXISTS reader_markers')));
    $db->prepare('INSERT INTO book_history(user,base_file,current_page,max_page,has_read,epub_cfi) VALUES (?,?,3,30,?,?)')
        ->execute(['reader','book',$read ? 1 : 0,$format === 'epub' ? 'epubcfi(/6/2!/4/1:3)' : null]);
    $state = initializeReaderProgress($db, 'reader', 'book', $format, 30);
    return [$db,$state];
}
function progressOperation(array $state, int $seq, string $locator, array $extra = []): array {
    return $extra + ['state_id'=>$state['state_id'],'expected_revision'=>$state['revision'],
        'policy_epoch'=>$state['policy_epoch'],'writer_id'=>'writer_A_123456789','seq'=>$seq,
        'locator'=>$locator,'furthest'=>$locator,'resume_policy'=>'last_position'];
}
foreach ([[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]] as $order) {
    foreach ([false,true] as $read) {
        [$db,$state] = progressFixture('archive',$read);
        $ops = [progressOperation($state,1,'20'),progressOperation($state,2,'10',['furthest'=>'20']),progressOperation($state,3,'1',['furthest'=>'20'])];
        foreach ($order as $index) saveReaderProgress($db,'reader','book',$ops[$index]);
        $saved = readerProgressState($db,'reader','book');
        expectProgress($saved['locator'] === '1','Reordered operations lost the last resume position.');
    }
    [$db,$state] = progressFixture();
    $ops = [progressOperation($state,1,'30',['completion_locator'=>'30','completion_seq'=>1]),
        progressOperation($state,2,'3',['furthest'=>'30','completion_locator'=>'30','completion_seq'=>1]),
        progressOperation($state,3,'1',['furthest'=>'30','completion_locator'=>'30','completion_seq'=>1])];
    foreach ($order as $index) saveReaderProgress($db,'reader','book',$ops[$index]);
    $saved = readerProgressState($db,'reader','book');
    expectProgress($saved['locator']==='1' && $saved['has_read'],'Completion followed by cover lost state.');
}
[$db,$state] = progressFixture('archive',true);
$a = progressOperation($state,1,'20');
$first=saveReaderProgress($db,'reader','book',$a);
expectProgress(saveReaderProgress($db,'reader','book',$a)['result']==='duplicate','Replay not recognized.');
expectProgress(saveReaderProgress($db,'reader','book',['csrf_token'=>'renewed']+array_reverse($a,true))['result']==='duplicate','Field order changed operation identity.');
$b=progressOperation($first['state'],1,'3',['writer_id'=>'writer_B_123456789']);
$second=saveReaderProgress($db,'reader','book',$b);
expectProgress(saveReaderProgress($db,'reader','book',progressOperation($state,2,'1'))['result']==='conflict','Foreign writer overwritten.');
updateReaderProgressPolicy($db,'reader',[$state['history_id']],false);
expectProgress(saveReaderProgress($db,'reader','book',progressOperation($second['state'],2,'30',['writer_id'=>'writer_B_123456789','completion_locator'=>'30','completion_seq'=>2]))['reason']==='state_changed','Old completion reversed manual unread.');
expectProgress(readerProgressState($db,'reader','book')['locator']==='3','Manual unread moved position.');
expectProgress((int)$db->query('SELECT max_page FROM book_history')->fetchColumn()===30,'Manual unread lost total.');
$db->exec('DELETE FROM book_history');
expectProgress(readerProgressState($db,'reader','book')===null,'Deleted history retained progress.');
[$db,$state]=progressFixture();
foreach (['31','0','1.5','1;script'] as $bad) {
    try { saveReaderProgress($db,'reader','book',progressOperation($state,1,$bad)); throw new RuntimeException('Invalid page accepted.'); }
    catch (ReaderProgressException $e) { expectProgress($e->status===400,'Wrong invalid page status.'); }
}
expectProgress(readerProgressState($db,'reader','book')['revision']===0,'Invalid save changed state.');
[$db,$state]=progressFixture('epub');
saveReaderProgress($db,'reader','book',progressOperation($state,1,'epubcfi(/6/2!/4/1:20)'));
saveReaderProgress($db,'reader','book',progressOperation($state,2,'epubcfi(/6/2!/4/1:9)'));
expectProgress(readerProgressState($db,'reader','book')['locator']==='epubcfi(/6/2!/4/1:9)','Backward EPUB movement was not saved.');
$linear=['total'=>3,'linear'=>[true,true,false]];
[$db,$state]=progressFixture('epub');
saveReaderProgress($db,'reader','book',progressOperation($state,1,'epubcfi(/6/6!/4/1:5)'),$linear);
expectProgress(readerProgressState($db,'reader','book')['locator']==='epubcfi(/6/6!/4/1:5)','Nonlinear note was not saved as the last position.');
foreach ([['epubcfi(/6/2!/4/1:9)','epubcfi(/6/2!/4/1:10)',-1],
 ['epubcfi(/6/2[chapter^,1]!/4/1:10)','epubcfi(/6/2!/4/1:10)',0],
 ['epubcfi(/6/2!/4,/1:2,/1:8)','epubcfi(/6/2!/4/1:3)',-1],
 ['epubcfi(/6/44!/4/2,,/1:14)','epubcfi(/6/44!/4/2)',0],
 ['epubcfi(/6/44!/4/2,/1:0,)','epubcfi(/6/44!/4/2/1:0)',0],
 ['epubcfi(/6/44!/4/2,,)','epubcfi(/6/44!/4/2)',0],
 ['epubcfi(/6/44!/4/2/1:0,,)','epubcfi(/6/44!/4/2/1:0)',0],
 ['epubcfi(/6/44!/4/2,,/1:14)','epubcfi(/6/44!/4/2/1:0)',-1],
 ['epubcfi(/6/10!/4/1:0)','epubcfi(/6/2!/4/1:0)',1]] as [$a,$b,$expected]) {
    expectProgress(compareReaderProgressCfi($a,$b)===$expected,'CFI comparison mismatch.');
}
// 章頭で相対経路が空になるFoliateの範囲CFIも、保存と復元に使えることを確認するルン。
$chapterMetadata = ['total'=>27,'linear'=>array_fill(0,27,true)];
foreach (['epubcfi(/6/44!/4/2,,/1:14)','epubcfi(/6/44!/4/2,/1:0,)',
    'epubcfi(/6/44!/4/2,,)','epubcfi(/6/44!/4/2/1:0,,)'] as $chapterStart) {
    foreach ([false,true] as $read) {
        [$db,$state]=progressFixture('epub',$read);
        $saved=saveReaderProgress($db,'reader','book',progressOperation($state,1,$chapterStart),$chapterMetadata);
        expectProgress($saved['result']==='applied' && $saved['state']['locator']===$chapterStart,
            'Chapter-start range CFI was not saved.');
        expectProgress($saved['state']['revision']===1 && $saved['state']['current_page']===22,
            'Chapter-start save lost revision or section.');
        expectProgress($db->query('SELECT epub_cfi FROM book_history')->fetchColumn()===$chapterStart,
            'Chapter-start CFI was not reflected in history.');
        expectProgress(initializeReaderProgress($db,'reader','book','epub',27)['locator']===$chapterStart,
            'Chapter-start CFI was not restored.');
    }
}
foreach ([false,true] as $read) {
    [$db,$state]=progressFixture('epub',$read);
    $chapterStart='epubcfi(/6/44!/4/2,,/1:14)';
    $furthest='epubcfi(/6/46!/4/2,,/1:14)';
    $saved=saveReaderProgress($db,'reader','book',progressOperation($state,1,$chapterStart,
        ['furthest'=>$furthest]),$chapterMetadata);
    expectProgress($saved['state']['locator']===$chapterStart,
        'Earlier chapter-start position was replaced by the furthest position.');
}
// 旧タブの最大位置保存は新しい保存方式へ自動で載せ替えないルン。
[$db,$state]=progressFixture();
$legacy=progressOperation($state,1,'20'); unset($legacy['resume_policy']);
try { saveReaderProgress($db,'reader','book',$legacy); throw new RuntimeException('Old resume policy accepted.'); }
catch (ReaderProgressException $e) { expectProgress($e->status===409 && $e->reason==='reader_update_required','Wrong old policy rejection.'); }
expectProgress(readerProgressState($db,'reader','book')['revision']===0,'Old policy changed saved progress.');
foreach (['epubcfi(/6/2!/4/1:2~1)','epubcfi(/6/2!/4/1:2@1:1)','epubcfi(/6/2[broken)',
    'epubcfi(/6/2,,)','epubcfi(/6/44!,,)','epubcfi(/6/44!/4,,!)',
    'epubcfi(/6/44!/4,,/)','epubcfi(/6/44!/4,!/2,)','bad'] as $bad) {
    try { readerProgressCfiParts($bad); throw new RuntimeException('Unsupported CFI accepted.'); }
    catch (ReaderProgressException $e) { expectProgress($e->status===422,'Wrong CFI status.'); }
}
// 既読の旧上限0でも実ページ位置を保持するルン。
[$db,$state]=progressFixture('archive',true);
$db->exec('DELETE FROM reader_progress'); $db->exec('UPDATE book_history SET current_page=20,max_page=0');
$state=initializeReaderProgress($db,'reader','book','archive');
expectProgress($state['locator']==='20' && $state['total_units']===null,'Legacy read position collapsed.');
initializeReaderProgress($db,'reader','book','archive',30);
expectProgress(readerProgressState($db,'reader','book')['revision']===0,'Metadata advanced operation revision.');
// OCFのパッケージパスを復号し、通常読書順を判定するルン。
$root = sys_get_temp_dir() . '/reader-progress-' . bin2hex(random_bytes(8));
mkdir($root); mkdir($root . '/fixture'); mkdir($root . '/fixture/META-INF');
try {
    file_put_contents($root . '/fixture/META-INF/container.xml', '<container><rootfiles><rootfile full-path="Book%20One.opf"/></rootfiles></container>');
    file_put_contents($root . '/fixture/Book One.opf', '<package><spine><itemref idref="a"/><itemref idref="note" linear="no"/></spine></package>');
    $metadata = readerProgressBookMetadata(['format'=>'epub'], ['path_hash'=>'fixture'], $root);
    expectProgress($metadata === ['total'=>2,'linear'=>[true,false]], 'Encoded package path or reading order not resolved.');
} finally {
    unlink($root . '/fixture/Book One.opf'); unlink($root . '/fixture/META-INF/container.xml');
    rmdir($root . '/fixture/META-INF'); rmdir($root . '/fixture'); rmdir($root);
}
// 別接続の書き込みロックで位置が失われないことを確認するルン。
$databaseFile = tempnam(sys_get_temp_dir(), 'reader-progress-lock-');
$left = $right = null;
try {
    $left = new PDO('sqlite:' . $databaseFile);
    $left->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $schema = file_get_contents(dirname(__DIR__, 2) . '/rsrc/sql/make-comistream-db-ddl.sql');
    $left->exec(substr($schema, 0, strpos($schema, 'CREATE TABLE IF NOT EXISTS reader_markers')));
    $left->exec("INSERT INTO book_history(user,base_file,current_page,max_page) VALUES ('reader','book',3,30)");
    $state = initializeReaderProgress($left, 'reader', 'book', 'archive', 30);
    $left->exec('CREATE TABLE system_config (key TEXT PRIMARY KEY, value TEXT)');
    $migration = file_get_contents(dirname(__DIR__, 2) . '/rsrc/sql/migration_021_add_reader_progress.sql');
    $left->exec($migration); $left->exec($migration);
    expectProgress(readerProgressState($left,'reader','book')['state_id']===$state['state_id'], 'Repeated migration changed state.');
    $right = new PDO('sqlite:' . $databaseFile);
    $right->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $right->exec('PRAGMA busy_timeout = 20');
    $left->exec('BEGIN IMMEDIATE');
    try {
        saveReaderProgress($right,'reader','book',progressOperation($state,1,'20'));
        throw new RuntimeException('Concurrent write ignored database lock.');
    } catch (PDOException $e) {
        expectProgress(str_contains($e->getMessage(), 'locked'), 'Unexpected lock failure.');
    }
    $left->exec('ROLLBACK');
    expectProgress(readerProgressState($right,'reader','book')['revision']===0, 'Locked write changed progress.');
    expectProgress(saveReaderProgress($right,'reader','book',progressOperation($state,1,'20'))['state']['locator']==='20', 'Save did not recover after lock.');
} finally {
    $left = $right = null;
    unlink($databaseFile);
}
echo "reader_progress.test.php: OK\n";
