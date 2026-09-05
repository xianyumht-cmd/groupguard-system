export type OutputLocale = 'zh-CN' | 'zh-TW' | 'en';

export type OutputTranslationFn = (text: string, locale: Exclude<OutputLocale, 'zh-CN'>) => Promise<string>;

const CACHE_LIMIT = 2000;
const translationCache = new Map<string, string>();
const inflightTranslations = new Map<string, Promise<string>>();
const TRANSLATION_CONCURRENCY = 8;
let activeTranslations = 0;
const translationWaiters: Array<() => void> = [];
const CJK_PATTERN = /[\u3400-\u9fff]/;

const EXACT_TRANSLATIONS: Record<string, { 'zh-TW': string; en: string }> = {
  '复制下面内容到浏览器打开：': {
    'zh-TW': '複製下方內容到瀏覽器開啟：',
    en: 'Copy the content below and open it in your browser:'
  },
  '已找到资源，稍后发送链接。请不要连续重复触发。': {
    'zh-TW': '已找到資源，稍後傳送連結。請勿連續重複觸發。',
    en: 'Resource found. The link will be sent shortly. Please do not trigger it repeatedly.'
  },
  '正在载入回复内容...': {
    'zh-TW': '正在載入回覆內容...',
    en: 'Loading reply content...'
  },
  '正在载入回复内容.': {
    'zh-TW': '正在載入回覆內容。',
    en: 'Loading reply content...'
  },
  '正在加载回复内容...': {
    'zh-TW': '正在載入回覆內容...',
    en: 'Loading reply content...'
  },
  '需要主人权限': { 'zh-TW': '需要主人權限', en: 'Owner permission is required.' },
  '需要管理员权限': { 'zh-TW': '需要管理員權限', en: 'Administrator permission is required.' },
  '暂无违禁词': { 'zh-TW': '暫無違禁詞', en: 'No blocked words are configured.' },
  '暂无拒绝词': { 'zh-TW': '暫無拒絕詞', en: 'No rejection keywords are configured.' },
  '未找到相关问答': { 'zh-TW': '未找到相關問答', en: 'No matching Q&A entry was found.' },
  '关键词和回复不能为空': { 'zh-TW': '關鍵詞和回覆不能為空', en: 'The keyword and reply cannot be empty.' },
  '链接内容已拦截，机器人不直接发送。': {
    'zh-TW': '連結內容已攔截，機器人不直接傳送。',
    en: 'Link content was blocked and will not be sent directly by the bot.'
  },
  '链接已做编号化处理，原始地址不由机器人直接发送。': {
    'zh-TW': '連結已做編號化處理，原始位址不由機器人直接傳送。',
    en: 'Links were numbered; the bot will not send the original addresses directly.'
  }
};

const ENGLISH_LABELS: Array<[RegExp, string]> = [
  [/查封号/g, 'ban lookup'],
  [/查战绩/g, 'match history query'],
  [/查合集/g, 'shard query'],
  [/海符榜/g, 'shard ranking query'],
  [/查骗子/g, 'scammer lookup'],
  [/查同行/g, 'peer lookup'],
  [/查询/g, 'query']
];

const TRADITIONAL_PHRASES: Array<[string, string]> = [
  ['正在载入', '正在載入'], ['正在加载', '正在載入'], ['回复', '回覆'], ['资源', '資源'], ['链接', '連結'],
  ['查询', '查詢'], ['过于频繁', '過於頻繁'], ['频繁', '頻繁'], ['全局', '全域'], ['每分钟', '每分鐘'],
  ['本群', '本群'], ['上限', '上限'], ['功能已关闭', '功能已關閉'], ['稍后', '稍後'], ['发送', '傳送'],
  ['连续', '連續'], ['重复', '重複'], ['触发', '觸發'], ['管理员', '管理員'], ['权限', '權限'],
  ['处理结果', '處理結果'], ['系统提示', '系統提示'], ['通知', '通知'], ['提示', '提示'], ['操作反馈', '操作回饋'],
  ['温馨提示', '溫馨提示'], ['提醒一下', '提醒一下'], ['校验结果', '校驗結果'], ['失败', '失敗'], ['错误', '錯誤'],
  ['请稍后再试', '請稍後再試'], ['未找到', '未找到'], ['已找到', '已找到'], ['当前', '目前'], ['设置', '設定'],
  ['分钟', '分鐘'], ['秒', '秒'], ['用户', '使用者'], ['冷却', '冷卻'], ['今日', '今日'], ['当日', '當日'],
  ['格式错误', '格式錯誤'], ['请输入', '請輸入'], ['有效', '有效'], ['内容', '內容'], ['浏览器', '瀏覽器'],
  ['打开', '開啟'], ['复制', '複製'], ['原始地址', '原始位址'], ['机器人', '機器人'], ['直接', '直接'],
  ['拦截', '攔截'], ['隐藏', '隱藏'], ['编号', '編號'], ['已关闭', '已關閉'], ['开启', '開啟'], ['关闭', '關閉'],
  ['精确', '精確'], ['模糊', '模糊'], ['正则', '正則'], ['关键词', '關鍵詞'], ['问答', '問答'], ['违禁词', '違禁詞'],
  ['拒绝词', '拒絕詞'], ['移除', '移除'], ['删除', '刪除'], ['添加', '新增'], ['列表', '清單'], ['为空', '為空'],
  ['群主', '群主'], ['文件', '檔案'], ['软件', '軟體'], ['视频', '影片']
];

// Common simplified-only characters that occur frequently in GroupGuard custom Q&A.
// This is a fail-safe for zh-TW when every remote translator is unavailable; the normal
// path still uses machine translation so words and context are handled rather than only characters.
const S2T_CHAR_MAP: Record<string, string> = Object.fromEntries(Array.from('万与专业东丝两严丧个临为丽举义乌乐乔习乡书买乱争于亏云亚产亩亲亿仅从仓仪们价众优会伞伟传伤伦伪体余佣侠侣侥侧侦俩债倾偿储儿兑党兰关兴养兽内冈册写军农冲决况冻净准凉减几凤凭凯击凿刘则刚创删别刹剂剑剧劝办务动励劳势勋匀区医华协单卖卢卤厅历厉压厌厕厘厦厨县叁参双发变叙叶号叹吓吕吗吨听启吴呐呒员呛呜咏咙咸响哑哒哓哔哗哙哜哝哟唤啧喷嘘嘤嘱噜团园围国图圆圣场坏块坚坛坝坞坟坠垄垒垦埘执堑堕墙壮声壶处备复够头夸夹夺奋奖奥妇妈妩妪妫姗娄娅娆娇娈娱婴婵婶孙学宁宝实宠审宪宫宽宾寝对寻导寿将尔尘尝层届属岁岂岗岚岛岭岳岿峄峡峥币帅师帐帘帜带帮幺广庄庆庐库应庙庞废开异弃张弥弦弯弹强归当录彦彻径忆忧怀态怂总恋恳恶恸恹恺恻恼恽悦悯惊惧惨惩惫惬惭惯愤愿懒戏战户扑执扩扫扬扰抚抛抢护报担拟拢拣拥拦拧拨择挂挚挛挤挥挽捞损换据掳掷掸掺掼揽搀搁搂搅携摄摆摇摈摊撄撑撵撸撷擞攒敌数斋斓斗斩断无旧时旷昙昼显晋晒晓晔晕暂术朴机杀杂权条来杨极构枪柜标栈栋栏树样桥桩梦检棂椭楼榄榇槛横樱橱欢欧欲歼殁殇残殒殓殚殡殴毁毂毕毙毡毵氢汇汉汤沟没沣沤沥沦沧沪泞泪泶泷泸泺泽洁洒洼浅浆浇测济浑浓浔涂涌涛涝涟涡涣涤润涧涨涩淀渊渍渎渐渔渗温湾湿溃溅滚滞满滤滥滦滨滩潆潇潋潍潜澜濑濒灭灯灵灾灿炉点炼炽烁烂烛烟烦烧烫热焕爱爷牍牵牺状犹狈狞独狭狮狱猎猫献猕玑玛环现玺珐珑琐琼瑶电画畅畴疟疗疡疮疯疱痈痉痒痨痪痫瘫瘾癞皑皱盏盐监盖盘着睁睐睑瞒瞩矫矿码砖砚砺砾础硕确碍碱礼祯祷祸禀离秃秆种积称秽稳穷窃窍窑窜窝窥竞笃笋笔笺笼笾筑筛筹签简箓箫篮篱簖籁籴类籼粜粝粤粪粮紧纠红纤约级纨纪纬纭纯纰纱纲纳纵纶纷纸纹纺纽线练组绅细织终绉绊绍绎经绑绒结绕绘给绚络绝绞统绢绣继绩绪绫续绮绯绰绳维绵绷绸综绽绿缀缁缂缃缄缅缆缇缈缉缎缓缔缕编缘缚缝缠缤缨缩缪缫缬缭缮缯缰缴罢罗罚罢羁羟翘耸耻聂聋职联聪肃肠肤肾肿胀胁胆胜胶脉脏脑脓脚脱脸腊腻腾舰舱艰艳艺节芜芦苇苈苋苍苏苹范茎茏茑茧荆荐荚荛荜荞荟荠荡荣荤荥荦荧荨莅莱莲莳获莸莹莺萝萤营萧萨葱蒇蒉蒋蓝蓟蓦蔷蔹蕲蕴薮藓蘖虏虑虚虫虽虾蚀蚁蚂蚕蛊蛎蛏蛮蜕蝇蝈蝉蝼蝾螀衅衔补表衬衮袄袅袜袭装裆裢裤褛见观规觅视览觉觊觋觌觎觏觐觑角觞触订讣计讯记讦讨让训议讯讳讴讵讶讷许讹论讼讽设访诀证评诅识诈诉诊词诎诏译诒诓诔试诗诘诙诚诛话诞诟诠诡询诣该详诧诨诩诫诬语误诰诱诲诳说诵请诸诺读诽课谁调谅谆谈谊谋谍谎谏谐谑谓谙谚谜谢谣谤谦谨谩谪谬谭谱谴谷贝贞负贡财责贤败账货质贩贪贫贬购贮贯贰贱贲贴贵贷贸费贺贻贼贾贿赂赃资赈赊赋赌赎赏赐赔赖赘赚赛赞赠赵赶趋跃跄践跷跸跹踊踌踪踬踯蹑蹒蹿躏躯车轧轨轩转轮软轰轴轻载轿较辅辆辈辉辊辋辍辎辏辐辑输辕辖辗辘辙辞辩辫边辽达迁过迈运还这进远违连迟迩迳迹适选逊递逻遗遥邓邝郑邻郁郏郐郓郦邮郸酝酱酿释里鉴针钉钊钋钌钍钎钏钐钒钓钔钕钗钙钚钛钜钝钞钟钠钡钢钣钥钦钧钨钩钮钰钱钲钳钴钵钹钻钾铀铁铃铄铅铆铈铉铊铋铌铍铎铐铑铒铕铖铗铙铛铜铝铡铠铢铣铤铥铧铨铩铪铫铬铭铮铯铰铱铲铳银铸铺链销锁锄锅锈锋锌锐锑锒锓锔锕锖锗错锚锛锝锞锟锡锢锣锤锥锦锨锩锫锬锭键锯锰锱锲锵锶锷锸锹锻镀镁镂镇镉镊镌镍镏镐镑镒镓镔镖镗镘镙镛镜镝镞镟镡镢镣镤镥镦镧镨镩镪镫镬镭镰镱镲长门闩闪闫闭问闯闰闲间闵闷闸闹闺闻闽闾阀阁阂阅阆阈阉阊阋阎阐阑阒阔阕阖阙队阳阴阵阶际陆陈陉陕陨险随隐隶难雏雠雳雾霁霉静韦韩韬韵页顶顷项顺须顽顾顿颁颂预颅领颇颈颊颐频颓颖颗题颚颜额颠颡颢颤风飒飓飕飘飙飞饥饭饮饯饰饱饲饴饵饶饷饺饼饿馀馆馈馋馍馏馐馒马驭驮驯驰驱驳驴驶驷驸驹驻驼驽驾驿骀骁骂骄骅骆骇骈骊骋验骏骑骗骚骛骜骤骥骧鱼鲁鲂鲅鲈鲋鲍鲎鲐鲑鲒鲔鲕鲚鲛鲜鲞鲟鲠鲡鲢鲣鲤鲥鲦鲧鲨鲩鲫鲭鲮鲰鲱鲲鲳鲴鲵鲶鲷鲸鲺鲻鲼鲽鳃鳄鳅鳆鳇鳌鳍鳎鳏鳐鳓鳔鳕鳖鳗鳘鳙鳜鳝鳞鳟鳢鸟鸡鸢鸣鸥鸦鸨鸩鸪鸫鸭鸯鸱鸲鸳鸵鸶鸷鸸鸹鸺鸽鸾鸿鹁鹂鹃鹄鹅鹆鹇鹈鹉鹊鹌鹏鹑鹕鹗鹘鹚鹜鹞鹤鹦鹧鹨鹩鹪鹫鹬鹭鹰鹳麦麸黄黉黩齐齿龀龃龄龅龆龇龈龉龊龋龌龙龚龛龟').map((ch, index) => [ch, Array.from('萬與專業東絲兩嚴喪個臨為麗舉義烏樂喬習鄉書買亂爭於虧雲亞產畝親億僅從倉儀們價眾優會傘偉傳傷倫偽體餘傭俠侶僥側偵倆債傾償儲兒兌黨蘭關興養獸內岡冊寫軍農沖決況凍淨準涼減幾鳳憑凱擊鑿劉則剛創刪別剎劑劍劇勸辦務動勵勞勢勳勻區醫華協單賣盧鹵廳歷厲壓厭廁釐廈廚縣參參雙發變敘葉號嘆嚇呂嗎噸聽啟吳吶嘸員嗆嗚詠嚨鹹響啞噠嘵嗶嘩噲嚌噥喲喚嘖噴噓嚶囑嚕團園圍國圖圓聖場壞塊堅壇壩塢墳墜壟壘墾塒執塹墮牆壯聲壺處備復夠頭誇夾奪奮獎奧婦媽嫵嫗媯姍婁婭嬈嬌孌娛嬰嬋嬸孫學寧寶實寵審憲宮寬賓寢對尋導壽將爾塵嘗層屆屬歲豈崗嵐島嶺嶽巋嶧峽崢幣帥師帳簾幟帶幫么廣莊慶廬庫應廟龐廢開異棄張彌弦彎彈強歸當錄彥徹徑憶憂懷態慫總戀懇惡慟懨愷惻惱惲悅憫驚懼慘懲憊愜慚慣憤願懶戲戰戶撲執擴掃揚擾撫拋搶護報擔擬攏揀擁攔擰撥擇掛摯攣擠揮挽撈損換據擄擲撣摻摜攬攙擱摟攪攜攝擺搖擯攤攖撐攆擼擷擻攢敵數齋斕鬥斬斷無舊時曠曇晝顯晉曬曉曄暈暫術樸機殺雜權條來楊極構槍櫃標棧棟欄樹樣橋樁夢檢欞橢樓欖櫬檻橫櫻櫥歡歐慾殲歿殤殘殞殮殫殯毆毀轂畢斃氈毿氫匯漢湯溝沒灃漚瀝淪滄滬濘淚澩瀧瀘濼澤潔灑窪淺漿澆測濟渾濃潯塗湧濤澇漣渦渙滌潤澗漲澀澱淵漬瀆漸漁滲溫灣濕潰濺滾滯滿濾濫灤濱灘瀠瀟瀲濰潛瀾瀨瀕滅燈靈災燦爐點煉熾爍爛燭煙煩燒燙熱煥愛爺牘牽犧狀猶狽獰獨狹獅獄獵貓獻獼璣瑪環現璽琺瓏瑣瓊瑤電畫暢疇瘧療瘍瘡瘋皰癰痙癢癆瘓癇癱癮癩皚皺盞鹽監蓋盤著睜睞瞼瞞矚矯礦碼磚硯礪礫礎碩確礙鹼禮禎禱禍稟離禿稈種積稱穢穩窮竊竅窯竄窩窺競篤筍筆箋籠籩築篩籌簽簡籙簫籃籬籪籟糴類秈糶糲粵糞糧緊糾紅纖約級紈紀緯紜純紕紗綱納縱綸紛紙紋紡紐線練組紳細織終縐絆紹繹經綁絨結繞繪給絢絡絕絞統絹繡繼績緒綾續綺緋綽繩維綿繃綢綜綻綠綴緇緙緗緘緬纜緹緲緝緞緩締縷編緣縛縫纏繽纓縮繆繅纈繚繕繒韁繳罷羅罰罷羈羥翹聳恥聶聾職聯聰肅腸膚腎腫脹脅膽勝膠脈臟腦膿腳脫臉臘膩騰艦艙艱艷藝節蕪蘆葦藶莧蒼蘇蘋範莖蘢蔦繭荊薦莢蕘蓽蕎薈薺蕩榮葷滎犖熒蕁蒞萊蓮蒔獲蕕瑩鶯蘿螢營蕭薩蔥蕆蕢蔣藍薊驀薔蘞蘄蘊藪蘚櫱虜慮虛蟲雖蝦蝕蟻螞蠶蠱蠣蟶蠻蛻蠅蟈蟬螻蠑螿釁銜補錶襯袞襖裊襪襲裝襠褳褲褸見觀規覓視覽覺覬覡覿覦覯覲覷角觴觸訂訃計訊記訐討讓訓議訊諱謳詎訝訥許訛論訟諷設訪訣證評詛識詐訴診詞詘詔譯詒詿誄試詩詰詼誠誅話誕詬詮詭詢詣該詳詫諢詡誡誣語誤誥誘誨誑說誦請諸諾讀誹課誰調諒諄談誼謀諜謊諫諧謔謂諳諺謎謝謠謗謙謹謾謫謬譚譜譴穀貝貞負貢財責賢敗賬貨質販貪貧貶購貯貫貳賤賁貼貴貸貿費賀貽賊賈賄賂贓資賑賒賦賭贖賞賜賠賴贅賺賽讚贈趙趕趨躍蹌踐蹺蹕躚踴躊蹤躓躑躡蹣躥躪軀車軋軌軒轉輪軟轟軸輕載轎較輔輛輩輝輥輞輟輜輳輻輯輸轅轄輾轆轍辭辯辮邊遼達遷過邁運還這進遠違連遲邇逕跡適選遜遞邏遺遙鄧鄺鄭鄰鬱郟鄶鄆酈郵鄲醞醬釀釋裡鑒針釘釗釙釕釷釺釧釤釩釣鍆釹釵鈣鈈鈦鉅鈍鈔鐘鈉鋇鋼鈑鑰欽鈞鎢鉤鈕鈺錢鉦鉗鈷缽鈸鑽鉀鈾鐵鈴鑠鉛鉚鈰鉉鉈鉍鈮鈹鐸銬銠鉺銪鋮鋏鐃鐺銅鋁鍘鎧銖銑鋌銥鏵銓鎩鉿銚鉻銘錚銫鉸銥鏟銃銀鑄鋪鏈銷鎖鋤鍋鏽鋒鋅銳銻鋃鋟鋦錡錆鍺錯錨錛鍀錁錕錫錮鑼錘錐錦鍁錈錇錟錠鍵鋸錳錙鍥鏘鍶鍔鍤鍬鍛鍍鎂鏤鎮鎘鑷鐫鎳鎦鎬鎊鎰鎵鑌鏢鏜鏝鏍鏞鏡鏑鏃鏇鐔鐝鐐鏷鑥鐓鑭鐠鑹鏹鐙鑊鐳鐮鐿鑔長門閂閃閆閉問闖閏閒間閔悶閘鬧閨聞閩閭閥閣閡閱閬閾閹閶鬩閻闡闌闃闊闋闔闕隊陽陰陣階際陸陳陘陝隕險隨隱隸難雛讎靂霧霽黴靜韋韓韜韻頁頂頃項順須頑顧頓頒頌預顱領頗頸頰頤頻頹穎顆題顎顏額顛顙顥顫風颯颶颼飄飆飛飢飯飲餞飾飽飼飴餌饒餉餃餅餓餘館饋饞饃餾饈饅馬馭馱馴馳驅駁驢駛駟駙駒駐駝駑駕驛駘驍罵驕驊駱駭駢驪騁驗駿騎騙騷騖驁驟驥驤魚魯魴鮁鱸鮒鮑鱟鮐鮭鮚鮪鮞鱭鮫鮮鯗鱘鯁鱺鰱鰹鯉鰣鰷鯀鯊鯇鯽鯖鯪鯫鯡鯤鯧鯝鯢鯰鯛鯨鯴鯔鱝鰈鰓鱷鰍鰒鰉鰲鰭鰨鰥鰩鰳鰾鱈鱉鰻鰵鱅鱖鱔鱗鱒鱧鳥雞鳶鳴鷗鴉鴇鴆鴣鶇鴨鴦鴟鴝鴛鴕鷥鷙鴯鴰鵂鴿鸞鴻鵓鸝鵑鵠鵝鵒鷳鵜鵡鵲鵪鵬鶉鶘鶚鶻鷀鶩鷂鶴鸚鷓鷚鷯鷦鷲鷸鷺鷹鸛麥麩黃黌黷齊齒齔齟齡齙齠齜齦齬齪齲齷龍龔龕龜')[index] || ch]));

export function normalizeOutputLocale(value: unknown): OutputLocale {
  return value === 'zh-TW' || value === 'en' ? value : 'zh-CN';
}

function trimCache(): void {
  if (translationCache.size <= CACHE_LIMIT) return;
  const removeCount = translationCache.size - CACHE_LIMIT;
  for (const key of Array.from(translationCache.keys()).slice(0, removeCount)) translationCache.delete(key);
}

async function withTranslationPermit<T>(operation: () => Promise<T>): Promise<T> {
  if (activeTranslations >= TRANSLATION_CONCURRENCY) {
    await new Promise<void>((resolve) => translationWaiters.push(resolve));
  }
  activeTranslations += 1;
  try {
    return await operation();
  } finally {
    activeTranslations -= 1;
    translationWaiters.shift()?.();
  }
}

function fastTranslateWhole(text: string, locale: Exclude<OutputLocale, 'zh-CN'>): string | null {
  const exact = EXACT_TRANSLATIONS[text.trim()];
  if (exact) {
    const leading = text.match(/^\s*/)?.[0] || '';
    const trailing = text.match(/\s*$/)?.[0] || '';
    return `${leading}${exact[locale]}${trailing}`;
  }

  if (locale === 'en') {
    let match = text.match(/^(.+?)过于频繁（全局每分钟上限\s*(\d+)\s*次）$/);
    if (match) return `Too many ${englishLabel(match[1])} requests (global limit: ${match[2]} per minute).`;
    match = text.match(/^(.+?)过于频繁（本群查询每分钟上限\s*(\d+)\s*次）$/);
    if (match) return `Too many ${englishLabel(match[1])} requests (this group is limited to ${match[2]} queries per minute).`;
    match = text.match(/^(.+?)过于频繁（本群该指令每分钟上限\s*(\d+)\s*次）$/);
    if (match) return `Too many ${englishLabel(match[1])} requests (this command is limited to ${match[2]} per minute in this group).`;
    match = text.match(/^(.+?)过于频繁（全局最小间隔\s*(\d+)\s*秒）$/);
    if (match) return `${englishLabel(match[1], true)} is being used too frequently (global minimum interval: ${match[2]} seconds).`;
    match = text.match(/^(.+?)过于频繁（本群最小间隔\s*(\d+)\s*秒）$/);
    if (match) return `${englishLabel(match[1], true)} is being used too frequently (minimum interval in this group: ${match[2]} seconds).`;
    match = text.match(/^(.+?)过于频繁（同用户冷却\s*(\d+)\s*秒）$/);
    if (match) return `${englishLabel(match[1], true)} is being used too frequently (per-user cooldown: ${match[2]} seconds).`;
    match = text.match(/^(.+?)已达本群当日上限（(\d+)\s*次）$/);
    if (match) return `${englishLabel(match[1], true)} has reached this group's daily limit (${match[2]}).`;
    match = text.match(/^本群(.+?)功能已关闭$/);
    if (match) return `${englishLabel(match[1], true)} is disabled in this group.`;
  }

  return null;
}

function englishLabel(raw: string, sentenceCase = false): string {
  let text = String(raw || '').trim();
  for (const [pattern, replacement] of ENGLISH_LABELS) text = text.replace(pattern, replacement);
  if (CJK_PATTERN.test(text)) text = 'query';
  return sentenceCase ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function localTraditionalFallback(text: string): string {
  let out = text;
  for (const [from, to] of TRADITIONAL_PHRASES) out = out.split(from).join(to);
  return Array.from(out).map(ch => S2T_CHAR_MAP[ch] || ch).join('');
}

function protectText(text: string): { protectedText: string; restore: (value: string) => string } {
  const protectedValues: string[] = [];
  const patterns = [
    /```[\s\S]*?```/g,
    /`[^`\n]+`/g,
    /\[CQ:[^\]]+\]/g,
    /https?:\/\/[^\s<>"'`]+/gi,
    /www\.[^\s<>"'`]+/gi,
    /\{[A-Za-z0-9_.-]+\}/g,
    /\b[A-Za-z]:\\[^\s\r\n]+/g,
    /(?:^|\s)\/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+/g
  ];
  let protectedText = text;
  for (const pattern of patterns) {
    protectedText = protectedText.replace(pattern, (value) => {
      const index = protectedValues.push(value) - 1;
      return `__GGPROTECT${index}__`;
    });
  }
  return {
    protectedText,
    restore: (value: string) => protectedValues.reduce((result, original, index) => {
      const token = `__GGPROTECT${index}__`;
      return result.split(token).join(original);
    }, value)
  };
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function translateViaLibre(text: string, locale: Exclude<OutputLocale, 'zh-CN'>): Promise<string> {
  const endpoint = String(process.env.GROUPGUARD_TRANSLATE_ENDPOINT || 'https://libretranslate.com/translate').trim();
  if (!endpoint || endpoint.toLowerCase() === 'off') throw new Error('translation_endpoint_disabled');
  const body: Record<string, string> = {
    q: text,
    source: 'zh',
    target: locale === 'zh-TW' ? 'zt' : 'en',
    format: 'text'
  };
  const apiKey = String(process.env.GROUPGUARD_TRANSLATE_API_KEY || '').trim();
  if (apiKey) body.api_key = apiKey;
  const data = await fetchJson(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body)
  }, 3500);
  const translated = String(data?.translatedText || '').trim();
  if (!translated) throw new Error('empty_translation');
  return translated;
}

async function translateViaMyMemory(text: string, locale: Exclude<OutputLocale, 'zh-CN'>): Promise<string> {
  if (Buffer.byteLength(text, 'utf8') > 450) throw new Error('mymemory_text_too_long');
  const target = locale === 'zh-TW' ? 'zh-TW' : 'en';
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', text);
  url.searchParams.set('langpair', `zh-CN|${target}`);
  url.searchParams.set('mt', '1');
  const data = await fetchJson(url.toString(), { method: 'GET', headers: { accept: 'application/json' } }, 2500);
  const translated = String(data?.responseData?.translatedText || '').trim();
  if (!translated || translated.toLowerCase().includes('no query specified')) throw new Error('empty_translation');
  return translated;
}

export const defaultOutputTranslator: OutputTranslationFn = async (text, locale) => {
  let lastError: unknown;
  for (const provider of [translateViaLibre, translateViaMyMemory]) {
    try {
      return await provider(text, locale);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('translation_unavailable');
};

export async function localizeOutputText(
  value: unknown,
  localeInput: unknown,
  translator: OutputTranslationFn = defaultOutputTranslator
): Promise<string> {
  const text = String(value ?? '');
  const locale = normalizeOutputLocale(localeInput);
  if (!text || locale === 'zh-CN' || !CJK_PATTERN.test(text)) return text;

  const fast = fastTranslateWhole(text, locale);
  if (fast !== null) return fast;

  if (locale === 'zh-TW') {
    // Do cheap deterministic conversion first. If it removes every simplified-only
    // character in common GroupGuard text there is no reason to add network latency.
    const local = localTraditionalFallback(text);
    if (local !== text) return local;
  }

  const cacheKey = `${locale}\n${text}`;
  const cached = translationCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const inflight = inflightTranslations.get(cacheKey);
  if (inflight) return inflight;

  const operation = (async () => {
    const protectedValue = protectText(text);
    try {
      const translated = await withTranslationPermit(() => translator(protectedValue.protectedText, locale));
      const restored = protectedValue.restore(String(translated || '').trim());
      if (!restored) throw new Error('empty_translation');
      translationCache.set(cacheKey, restored);
      trimCache();
      return restored;
    } catch {
      if (locale === 'zh-TW') return localTraditionalFallback(text);
      // English mode is deliberately fail-closed: never leak Simplified Chinese when
      // the operator selected full English output. Common system messages use the
      // local fast path above, while an unseen custom Q&A can retry on the next hit.
      return 'Translation is temporarily unavailable. Please try again shortly.';
    } finally {
      inflightTranslations.delete(cacheKey);
    }
  })();
  inflightTranslations.set(cacheKey, operation);
  return operation;
}

async function localizeMessageValue(value: unknown, locale: OutputLocale, translator: OutputTranslationFn): Promise<unknown> {
  if (typeof value === 'string') return localizeOutputText(value, locale, translator);
  if (!Array.isArray(value)) return value;
  return Promise.all(value.map(async (segment) => {
    if (!segment || typeof segment !== 'object' || Array.isArray(segment)) return segment;
    const cloned: Record<string, any> = { ...(segment as Record<string, any>) };
    const data = cloned.data && typeof cloned.data === 'object' && !Array.isArray(cloned.data)
      ? { ...cloned.data }
      : cloned.data;
    cloned.data = data;
    if (cloned.type === 'text' && data && typeof data.text === 'string') {
      data.text = await localizeOutputText(data.text, locale, translator);
    }
    return cloned;
  }));
}

async function localizeForwardNodes(value: unknown, locale: OutputLocale, translator: OutputTranslationFn): Promise<unknown> {
  if (!Array.isArray(value)) return value;
  return Promise.all(value.map(async (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
    const cloned: Record<string, any> = { ...(node as Record<string, any>) };
    const data = cloned.data && typeof cloned.data === 'object' && !Array.isArray(cloned.data)
      ? { ...cloned.data }
      : cloned.data;
    cloned.data = data;
    if (data && Object.prototype.hasOwnProperty.call(data, 'content')) {
      data.content = await localizeMessageValue(data.content, locale, translator);
    }
    return cloned;
  }));
}

export async function localizeOneBotSendParams(
  action: string,
  paramsInput: unknown,
  localeInput: unknown,
  translator: OutputTranslationFn = defaultOutputTranslator
): Promise<unknown> {
  const locale = normalizeOutputLocale(localeInput);
  if (locale === 'zh-CN' || !paramsInput || typeof paramsInput !== 'object' || Array.isArray(paramsInput)) return paramsInput;
  const params: Record<string, any> = { ...(paramsInput as Record<string, any>) };
  const normalizedAction = String(action || '').toLowerCase();
  if (normalizedAction === 'send_group_forward_msg' || normalizedAction === 'send_private_forward_msg') {
    params.messages = await localizeForwardNodes(params.messages, locale, translator);
    return params;
  }
  if (normalizedAction === 'send_group_msg' || normalizedAction === 'send_private_msg' || normalizedAction === 'send_msg') {
    params.message = await localizeMessageValue(params.message, locale, translator);
  }
  return params;
}

export function clearOutputLocaleCacheForTest(): void {
  translationCache.clear();
  inflightTranslations.clear();
}
