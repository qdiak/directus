# Quantum-csomagok kiadási eljárása

## Kanonikus kiadási határ

A Quantum-kiadás együtt kezeli a következő csomagokat:

| Munkaterület | Csomag | Függőségi szerep |
| --- | --- | --- |
| `app` | `quantum_directus_app` | Adminisztrációs alkalmazás |
| `api` | `quantum_directus_api` | Az Appot használó backend futtatókörnyezet |
| `directus` | `quantum_directus` | Az API-t használó metacsomag és CLI |

A build eszközláncának kanonikus forrása az aktuális workflow, a gyökérmanifest package manager- és engine-beállítása, valamint a lockfile. A csomagolt artifact fogyasztói mátrixát a `.github/workflows/quantum-embedded.yml` határozza meg; a konkrét eszköz- és futtatókörnyezet-verziókat ne másold át statikusan ebbe a dokumentumba.

Két SHA-t különböztess meg:

- **Csomagforrás-SHA:** az a commit/tree, amelynek forrásából és manifestjeiből a három tarball készül.
- **Felhatalmazási SHA:** a megváltoztathatatlan kiadási vagy újrapróbálási tag célja, amely a futtatandó közzétételi workflow-t is tartalmazza.

Szokásos kiadásnál a két SHA azonos. Csak workflow-t érintő újrapróbálás esetén eltérhetnek, de a felhatalmazási SHA-nak a csomagforrás-SHA leszármazottjának kell lennie, és a két commit között kizárólag a `.github/workflows/quantum-publish.yml` változhat. Ezt gépileg bizonyítsd; a commitüzenet vagy a diff kézi összefoglalása nem elegendő.

## Verziófrissítési módok

A munka megkezdése előtt rögzítsd, melyik módot kérte a felhasználó:

- **Meglévő verzió közzétételének előkészítése vagy újrapróbálása:** ne módosíts verziót; a már előkészített csomagforrás pontos értékeit ellenőrizd.
- **Quantum-sorszám-frissítés:** a három csomag alapverziója változatlan marad, csak a közös `-quantum.<sorszám>` előzetes kiadási azonosító változik.
- **Teljes verziófrissítés:** mindhárom csomag cél-alapverziója és közös Quantum-sorszáma változhat. A három alapverziónak nem kell azonosnak lennie, de mindegyiket előre, kifejezetten meg kell határozni.

Teljes verziófrissítésnél:

1. Azonosítsd a célkiadás alapjául szolgáló forrást és a task/PR által előírt forrás-, séma-, migrációs vagy kompatibilitási változásokat. A teljes verziófrissítés ne legyen puszta manifestbeli szövegcsere; ugyanakkor ne találj ki a feladatban nem kért upstream-szinkronizálást.
2. Frissítsd együtt az `app/package.json`, `api/package.json` és `directus/package.json` verzióját.
3. Keresd meg a korábbi pontos csomagverziók, kiadási branch, kiadási tag és Quantum-sorszám kiadáshoz kötött előfordulásait a workflow-kban, a gyökérmanifest scriptjeiben, a tesztekben és a dokumentációban. Csak az adott kiadáshoz tartozó hivatkozásokat módosítsd; az ettől független függőségverziókat ne írd át.
4. A közzétételi workflow a célcsomagok nevét és verzióját lehetőleg közvetlenül a manifestekből olvassa ki. Ha valamely értéknek biztonsági okból explicitnek kell maradnia, igazold, hogy az új célverziókkal és a felhatalmazási mechanizmussal egyezik.
5. Ha a manifestmódosítás a lockfile-ra hat, a repository által deklarált package managerrel frissítsd, majd rögzített lockfile-lal is ellenőrizd a telepítést. Kézzel ne szerkeszd a generált feloldásokat.
6. Ellenőrizd, hogy a csomagolt artifact pontosan az új társcsomagverziókat tartalmazza, és a repositoryban nem maradt a korábbi kiadáshoz kötött, aktív pontos verzió- vagy triggerhivatkozás.

## Előkészítés

1. Ellenőrizd a tiszta vagy ismert worktree-/indexállapotot, az `origin` URL-jét, az aktuális branchet és a kiadás célbranchét.
2. Olvasd ki a három manifestből a neveket és a verziókat. Ellenőrizd, hogy a kiválasztott frissítési mód szerinti alapverziókat és ugyanazt a `-quantum.<sorszám>` azonosítót használják.
3. Írásvédett előzetes registry-ellenőrzéssel vizsgáld meg mindhárom célverziót:

   ```bash
   npm view '<package>@<version>' version
   npm view '<package>' dist-tags --json
   ```

   Az `npm view` nullától eltérő kilépési kódja egy még nem létező pontos verziónál elvárt lehet. Ha bármelyik célverzió már létezik, csak akkor folytasd, ha bizonyíthatóan ugyanannak a részleges GitHub Actions-közzétételnek az újrapróbálásáról van szó; egyébként állj meg.

4. Írásvédett módon ellenőrizd, hogy a tervezett kiadási/újrapróbálási tag még nem létezik, és milyen tagszabálykészlet, branchvédelem vagy GitHub Environment-jóváhagyás védi a kiadást. Ha nincs technikai védelem, ezt ne rejtsd el: közzététel előtt külön irányítási kockázatként jelezd.
5. A csomagforrás változását tartalmazó commit/PR kerüljön az aktuális Quantum kiadási branchre. A repository távoli branch-e, a feladat kontextusa és a workflow-trigger az irányadó; a branch nevét ne ebből a dokumentumból vedd át.
6. A közzétételi workflow ne másolja át egy korábbi kiadás Quantum-sorszámát vagy pontos csomagverzióit. A manifestekből származó pontos csomagneveket és -verziókat használja, és ellenőrizze, hogy a három Quantum-sorszám összhangban van.

## A közzétételi workflow invariánsai

A `.github/workflows/quantum-publish.yml` csak akkor tekinthető kiadásra alkalmasnak, ha minden feltétel teljesül:

- kifejezett, megváltoztathatatlan kiadási tag vagy ezzel egyenértékű, védett kézi ellenőrzési pont adja a közzétételi felhatalmazást;
- a triggerként szolgáló tag korábban nem létezett, és az engedélyezett szereplő, szabálykészlet és környezeti szabályzat ellenőrizve van; önmagában a tagnév nem elegendő felhatalmazás;
- a checkoutolt commit egyértelműen a Quantum kiadási leszármazási vonalához tartozik;
- a tagból és a manifestekből meghatározott célverzió egyezik a három csomagmanifesttel;
- a felhatalmazási SHA-hoz tartozó `Quantum Embedded Runtime` pushfuttatás pontos `headSha` értéke, eseménye és workflow-útvonala megfelelő, és minden jobja sikeres;
- csak workflow-t érintő újrapróbálás esetén a csomagforrás- és a felhatalmazási SHA közötti teljes diff a közzétételi workflow-ra korlátozódik;
- a workflow a `pnpm install --frozen-lockfile` után felépíti a `quantum_directus_api...` függőségi körét;
- a csomagolt artifact tesztje bizonyítja a pontos API -> App, API -> Directus és Directus -> API társcsomag-függőségi éleket, és nem hagy `workspace:`, `file:` vagy `link:` specifikációt;
- minden közzétételi lépést csomagonkénti, írásvédett registry-ellenőrzés előz meg;
- már létező pontos verzió csak az előző részleges futtatás, valamint a registry-eredet és a tarball-integritás azonosságának bizonyítása után hagyható ki;
- a közzététel nyilvános hozzáféréssel, eredetigazolással és `canary` taggel történik;
- a közzétételi parancs az aktuális, repositoryban deklarált package managerrel bizonyított, csomagkönyvtáras formát használja; korábban hibásnak bizonyult parancsformát csak új, célzott validáció után vezess vissza;
- a workflow a végén mindhárom pontos verziót, függőségi élt, tarball-integritást, eredetigazolást és a `canary` dist-taget visszaolvassa;
- a workflow nem írja át a `latest` taget;
- a párhuzamossági csoport nem enged két Quantum-közzétételt párhuzamosan futni.

Ha az aktuális workflow egy korábbi kiadáshoz kötött, egyszeri, beégetett taget, branchet, SHA-t vagy csomagverziót tartalmaz, azt történeti megoldásként kezeld. Új kiadáshoz ne mozgasd a régi taget, ne írj át már közzétett verziót, és ne tekintsd a régi felhatalmazott SHA-t új kiadási felhatalmazásnak. Az új trigger és felhatalmazási mechanizmus külön felülvizsgálatot igényel.

## Validáció

A módosítás kockázatához illő legkisebb helyi ellenőrzéssel kezdj, majd közzététel előtt távoli ellenőrzési ponttal igazold a teljes mátrixot. A jelenleg releváns parancsok:

```bash
pnpm install --frozen-lockfile
pnpm --filter quantum_directus_api check:changed
pnpm --filter quantum_directus_api... build
pnpm --filter quantum_directus_api test:embedded
pnpm --filter quantum_directus_api test:artifact
pnpm build
```

Az `api/scripts/artifact-smoke.mjs` már ellenőrzi, hogy a csomagolt API- és Directus-manifest pontos társcsomagverzióra oldja fel a workspace-függőségeket, és nem marad helyi függőségspecifikáció. Tartsd meg ezt az ellenőrzési pontot. Az artifact smoke futtatókörnyezet-függőségeit és környezeti változóit a workflow-ból olvasd ki. Egyetlen helyi futtatókörnyezet sikeréből ne következtess a teljes Node-/Bun-CI-mátrix sikerére.

Teljes verziófrissítésnél ezenfelül ellenőrizd:

- mindhárom manifest pontos célverzióját és a közös Quantum-sorszámot;
- a lockfile konzisztenciáját és a rögzített lockfile-lal végzett telepítést;
- a korábbi kiadás pontos csomagspecifikációira, branchére, tagjére és triggerére végzett célzott keresés eredményét;
- hogy a kiadáshoz kötött workflow-, script-, teszt- és dokumentációs hivatkozások az új célállapotot írják le;
- hogy a csomagolt artifact társcsomag-függőségei mindhárom új célverzióra oldódnak fel.

A kiadási branch pontos SHA-jához tartozó távoli futtatást írásvédett módon keresd meg:

```bash
gh run list \
  --repo qdiak/directus \
  --workflow quantum-embedded.yml \
  --branch '<release-branch>' \
  --commit '<full-sha>' \
  --event push \
  --json databaseId,headSha,status,conclusion,url
```

Csak a `completed/success` állapot fogadható el. A futtatás részleteiben ellenőrizd a `headSha`, az esemény és a workflow-útvonal azonosságát, valamint minden mátrixjob sikerét. PR-futtatás, más SHA-hoz tartozó futtatás, azonos nevű másik workflow vagy részben sikeres joblista nem bizonyítja a közzétételre való alkalmasságot.

## Közzététel

1. Azonosítsd a kiadási branchre került csomagforrás-SHA-t, a felhatalmazási SHA-t, a három csomagspecifikációt és a sikeres beágyazott pushfuttatást.
2. Ellenőrizd, hogy az új tag nem létezik, mentsd el mindhárom csomag közzététel előtti `canary` és `latest` értékét, és ellenőrizd a felhatalmazás védelmi mechanizmusát.
3. Mutasd meg ezeket a felhasználónak, majd kérj kifejezett közzétételi jóváhagyást. A tag pusholása és a registry-workflow triggerelése csak erre a jóváhagyásra épülhet.
4. A jóváhagyás után hozz létre új, megváltoztathatatlan kiadási taget a felhatalmazott commiton, vagy indítsd el az aktuális, védett közzétételi workflow dokumentált triggerét. A tagnévnél a workflow aktuális mintája az irányadó.
5. Kövesd végig a közzétételi futtatást. Ne tekintsd sikeresnek pusztán azért, mert egy csomag már megjelent.
6. Olvasd vissza mindhárom pontos verziót, a pontos társcsomag-függőségi éleket, a tarball-integritást, az eredetigazolást, valamint a `canary` és `latest` taget. A `latest` változása hiba, amelyet azonnal jelezni kell.
7. Az átadásban rögzítsd mindkét kiadási SHA-t, a taget, a workflow futtatási URL-jét és a három registry-bizonyítékot.

## Újrapróbálás és hibakezelés

- **CI-hiba vagy hiányzó, pontos SHA-hoz tartozó pushfuttatás:** ne tegyél közzé semmit; javítsd a forrást új PR-ben/commitban, majd futtasd újra az összes ellenőrzést.
- **Közzétételi hiba az első sikeres csomag előtt:** javítsd a workflow-t a szokásos felülvizsgálati folyamatban. A régi taget ne mozgasd; új, megváltoztathatatlan újrapróbálási trigger és friss felhasználói közzétételi jóváhagyás kell.
- **Részleges közzététel:** ne emelj verziót csak a hiba elfedésére. Ugyanahhoz a csomagforrás-SHA-hoz készíts auditálható újrapróbálást. A már létező csomag csak akkor hagyható ki, ha az előző Actions-futtatás, az npm-eredet forrás-repositoryja, commitja és workflow-ja, valamint a tarball-integritás együtt ugyanahhoz a kiadáshoz köti; ha ez nem bizonyítható, állj meg. Tedd közzé a hiányzókat, majd együtt ellenőrizd mindhárom csomagot.
- **Csak workflow-t érintő újrapróbálási commit:** bizonyítsd, hogy a felhatalmazási SHA a csomagforrás-SHA leszármazottja, majd futtasd a teljes diffet úgy, hogy a `.github/workflows/quantum-publish.yml` kivételével minden útvonal tiltott legyen. Az újrapróbálás ne adhasson felhatalmazást más forrástartalomra, és a felhatalmazási SHA saját beágyazott pushfuttatásának is zöldnek kell lennie.
- **Már létező, ismeretlen eredetű pontos verzió:** állj meg. Az npm-verzió megváltoztathatatlan; ne próbáld felülírni, visszavonni vagy ugyanazzal a verzióval újra közzétenni.
- **Hibás dist-tag:** az `npm dist-tag` szintén registry-módosítás. Friss felhasználói felhatalmazás nélkül ne javítsd külön.
- **Hiányzó vagy érvénytelen `NPM_TOKEN`, eredetigazolási vagy jogosultsági hiba:** ne kérj és ne jeleníts meg titkos értéket. A repository adminisztrátorának jelezd a konkrét GitHub Actions-hibát.

## Átadás a fogyasztónak

A Directus közzétételének sikere nem módosíthat automatikusan másik repositoryt. Add át a három pontos csomagspecifikációt, a csomagforrás- és a felhatalmazási SHA-t, valamint a registry-bizonyítékokat. A Quantum-fogyasztó pontos pinjeinek, lockfile-jának, buildjének és konténer-elfogadási ellenőrzésének frissítését csak külön, arra felhatalmazott taskban végezd el.
