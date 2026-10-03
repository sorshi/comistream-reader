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
        'locator'=>$locator,'furthest'=>$locator];
}
foreach ([[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]] as $order) {
    foreach ([false,true] as $read) {
        [$db,$state] = progressFixture('archive',$read);
        $ops = [progressOperation($state,1,'20'),progressOperation($state,2,'10',['furthest'=>'20']),progressOperation($state,3,'1',['furthest'=>'20'])];
        foreach ($order as $index) saveReaderProgress($db,'reader','book',$ops[$index]);
        $saved = readerProgressState($db,'reader','book');
        expectProgress($saved['locator'] === ($read ? '1':'20'),'Reordered operations lost the resume position.');
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
$b=progressOperation($first['state'],1,'3',['writer_id'=>'writer_B_123456789']);
$second=saveReaderProgress($db,'reader','book',$b);
expectProgress(saveReaderProgress($db,'reader','book',progressOperation($state,2,'1'))['result']==='conflict','Foreign writer overwritten.');
updateReaderProgressPolicy($db,'reader',[$state['history_id']],false);
expectProgress(saveReaderProgress($db,'reader','book',progressOperation($second['state'],2,'30',['writer_id'=>'writer_B_123456789','completion_locator'=>'30','completion_seq'=>2]))['reason']==='state_changed','Old completion reversed manual unread.');
expectProgress(readerProgressState($db,'reader','book')['locator']==='3','Manual unread moved position.');
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
expectProgress(readerProgressState($db,'reader','book')['locator']==='epubcfi(/6/2!/4/1:20)','CFI max used lexical ordering.');
$linear=['total'=>3,'linear'=>[true,true,false]];
[$db,$state]=progressFixture('epub');
saveReaderProgress($db,'reader','book',progressOperation($state,1,'epubcfi(/6/6!/4/1:5)'),$linear);
expectProgress(readerProgressState($db,'reader','book')['locator']===$state['locator'],'Nonlinear note advanced unread.');
foreach ([['epubcfi(/6/2!/4/1:9)','epubcfi(/6/2!/4/1:10)',-1],
 ['epubcfi(/6/2[chapter^,1]!/4/1:10)','epubcfi(/6/2!/4/1:10)',0],
 ['epubcfi(/6/2!/4,/1:2,/1:8)','epubcfi(/6/2!/4/1:3)',-1],
 ['epubcfi(/6/10!/4/1:0)','epubcfi(/6/2!/4/1:0)',1]] as [$a,$b,$expected]) {
    expectProgress(compareReaderProgressCfi($a,$b)===$expected,'CFI comparison mismatch.');
}
foreach (['epubcfi(/6/2!/4/1:2~1)','epubcfi(/6/2!/4/1:2@1:1)','epubcfi(/6/2[broken)','epubcfi(/6/2,,)','bad'] as $bad) {
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
echo "reader_progress.test.php: OK\n";
