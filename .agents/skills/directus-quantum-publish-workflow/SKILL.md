---
name: directus-quantum-publish-workflow
description: A qdiak/directus fork három Quantum-csomagjának részleges vagy teljes verziófrissítése, kiadás-előkészítése, GitHub Actions-alapú canary közzététele, újrapróbálása és registry-ellenőrzése. Quantum Directus-verziófrissítéshez vagy közzétételhez használd; az upstream Directus szokásos kiadási folyamatához vagy egyszerű helyi buildhez ne használd.
---

# Directus Quantum közzétételi folyamat

Az `app`, `api` és `directus` workspace-eket egyetlen, pontos forrás-SHA-hoz kötött Quantum-kiadásként kezeld. A közzététel visszafordíthatatlan registry-módosítás; az előkészítésre adott engedély nem jelent közzétételi engedélyt.

## Első lépések

1. Olvasd ki az aktuális állapotot a `git status --short --branch`, a remote-ok, a három csomagmanifest, a `.github/workflows/quantum-embedded.yml` és a `.github/workflows/quantum-publish.yml` alapján.
2. Őrizd meg a felhasználó worktree- és indexállapotát. Külön felhasználói megerősítés nélkül ne válts branchet, és ne is hozz létre újat.
3. A futtatható workflow és a csomagmanifest mindig hitelesebb forrás, mint ez a skill. Ha eltérést találsz, jelezd, és a közzététel előtt tisztázd a követendő irányt.
4. A kiadási feladatnak legyen ismert célbranch-e és task-/PR-kontextusa. Ha verziófrissítést is kértek, annak módja és mindhárom csomagra vonatkozó célverziója is legyen egyértelmű. Hiányzó kontextus esetén ne találj ki verziót vagy kiadási felhatalmazást.

## Felhatalmazási határok

- Írásvédett audit során vizsgálhatod a GitHub-futtatásokat, a tageket és az npm registryt.
- Kiadás-előkészítéskor szerkesztheted a manifesteket, a teszteket, a workflow-t és a dokumentációt a kért branchen, de ettől még ne pusholj kiadási taget, és ne indíts közzétételi workflow-t.
- Közzététel előtt kérj friss, kifejezett jóváhagyást, amelyből egyértelműen látszik a három pontos csomagverzió, a forrásbranch/-SHA és a `canary` dist-tag.
- A felhasználói jóváhagyás, a kiadási tag létrehozási joga és a GitHub Actions registry-környezetének jóváhagyása három külön ellenőrzési pont. Mindhárom aktuális állapotát ellenőrizd; egy tag puszta létezése nem bizonyít védett felhatalmazást.
- Az újrapróbálás újabb registry-módosítási kísérlet, ezért ahhoz is friss, az új felhatalmazási SHA-ra és triggerre szóló közzétételi jóváhagyás kell.
- Ne futtass helyi `npm publish` vagy `pnpm publish` parancsot. A registry módosítása kizárólag a repository védett GitHub Actions-workflow-jából történhet.
- Régi kiadási taget soha ne mozgass vagy használj újra. A `latest` taget Quantum-előzetes kiadás közben ne módosítsd.

## Csomagszerződés

A következő manifesteket együtt verziózd:

- `app/package.json` -> `quantum_directus_app`
- `api/package.json` -> `quantum_directus_api`
- `directus/package.json` -> `quantum_directus`

A három alapverzió eltérhet, de a `-quantum.<sorszám>` előzetes kiadási azonosító legyen összhangban. Csak Quantum-sorszám-emelésnél őrizd meg az alapverziókat; opcionális teljes verziófrissítésnél mindhárom cél-alapverziót külön, kifejezetten határozd meg. A pontos manifestverziókat olvasd ki; ne kódold be egy korábbi kiadás értékeit. A csomagolt artifactban az API App- és Directus-függősége, valamint a Directus API-függősége pontosan az új társcsomagverziókra oldódjon fel. A közzétételi sorrend `app`, `api`, `directus`, mert az API az Appot, a Directus metacsomag pedig az API-t használja.

## Munkamódok

- **Felmérés:** módosítás nélkül állapítsd meg a manifest, a workflow, a CI, a tagek és a registry állapotát; ehhez olvasd el a [kiadási eljárás](references/release-procedure.md) `Előkészítés`, `A közzétételi workflow invariánsai` és `Validáció` részét.
- **Verziófrissítés:** ha a feladat verziómódosítást is kér, válassz a csak Quantum-sorszámot érintő frissítés és a teljes verziófrissítés között, majd olvasd el a [kiadási eljárás](references/release-procedure.md) `Verziófrissítési módok`, `Előkészítés`, `A közzétételi workflow invariánsai` és `Validáció` részét.
- **Kiadás-előkészítés:** olvasd el a [kiadási eljárás](references/release-procedure.md) `Előkészítés`, `A közzétételi workflow invariánsai` és `Validáció` részét.
- **Közzététel vagy újrapróbálás:** olvasd el a teljes [kiadási eljárás](references/release-procedure.md) fájlt, és végezd el az ott leírt ellenőrzéseket.

## Átadás

Külön sorold fel:

- a választott frissítési módot és teljes verziófrissítésnél annak teljes hatókörét;
- a három pontos csomagspecifikációt;
- az ellenőrzött csomagforrás- és felhatalmazási SHA-t, valamint a célbranchet;
- a helyben futtatott ellenőrzéseket és a GitHub CI-futtatás eredményét;
- a közzétételi workflow futtatási URL-jét és a registry ellenőrzésének eredményét, ha tényleges közzététel történt;
- hogy a `canary` és `latest` dist-tagek hogyan változtak;
- a fogyasztó repositoryban még szükséges pontos pin- és lockfile-frissítést, de ezt csak külön felhatalmazással végezd el.
