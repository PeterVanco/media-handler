import * as express from 'express';
import 'rxjs/add/operator/startWith';
import {EMPTY, from, iif, Observable, of, throwError} from "rxjs";
import * as recursive from 'recursive-readdir'
import * as NodeCache from 'node-cache'
import * as sharp from 'sharp'
import {catchError, concatMap, finalize, map, retryWhen, switchMap, tap, timeout} from "rxjs/operators";
import * as exif from 'exif'

require('console-stamp')(console);

const PORT = process.env.PORT || 3000;
const ROOT_FOLDER = process.env.ROOT_FOLDER || '\\\\DISKSERVER\\Photo';
const TARGET_FOLDER = process.env.TARGET_FOLDER || ROOT_FOLDER + '\\2019 Cestovanie - Macao';
const ALLOWED_RETRIES = 5;
const RESPONSE_TIMEOUT = 5000;

const app = express();

const cache = new NodeCache();
const CACHE_KEY = "cache";

const isImage = require('is-image');
const readChunk = require('read-chunk');
const imageType = require('image-type');

class CacheRecord {

    constructor(private records: string[]) {
        console.log(`constructed cache with ${records.length} items`)
    }

    public random(): string {
        console.log(`popping random item from cache with ${this.records.length} items`);
        if (!this.hasRecords()) {
            console.warn(`Cache is empty!`);
            return null;
        }
        const index = Math.floor(Math.random() * this.records.length);
        const item = this.records.splice(index, 1)[0];
        console.log(`popped item ${item}`);
        return item;
    }

    public remaining(): number {
        return this.records.length;
    }

    public hasRecords(): boolean {
        return this.remaining() !== 0;
    }

}

app.get("/random", (req, res) => {

    const cached = cache.get("cache") as CacheRecord;
    if (cached === undefined || !cached.hasRecords()) {
        console.log(`returning 404 due to empty cache`);
        res.writeHead(404, {'Content-Type': 'text/html'});
        res.end(`no items left`);
        return;
    }

    new Observable(o$ => {
        o$.next(cached.random());
        o$.complete();
    }).pipe(
        concatMap(getResizedImageAsBuffer()),
        timeout(RESPONSE_TIMEOUT),
        retryWhen(retryCondition),
        catchError(err => {
                console.log(`returning 500 - failed to get image`);
                console.error(err);
                res.writeHead(500);
                res.end(err.toString());
                return EMPTY;
            }
        ),
        finalize(() => {
            console.log(`${cached.remaining()} items remain in the cache`);
            cache.set(CACHE_KEY, cached, cache.getTtl(CACHE_KEY));
        }),
        concatMap(result => new Observable(o$ => {
            exif(result.file as string, (err, data) => {
                if (err !== null) {
                    o$.error(err);
                } else {
                    o$.next(data);
                    o$.complete();
                }
            });
        }).pipe(
            map(exif => {
                return {
                    ...result,
                    exif
                }
            }),
            catchError(err => {
                console.warn(`could not extract EXIF for ${result.file}`);
                return of(result);
            })
        )),
    ).subscribe({
        next: result => {
            // const bufferHead = data.splice(0, imageType.minimumBytes)
            const imageTypeResult = imageType(result.buffer);
            console.log(`returning 200 as ${result.file} - ${imageTypeResult.mime}`);
            let headers: any = {'Content-Type': imageTypeResult.mime};
            if ((result as any).exif) {
                headers = {
                    ...headers,
                    'X-Image-Date': (result as any).exif.exif.CreateDate
                }
            }

            headers = addImageNameHeader(result.file as string, headers);

            res.writeHead(200, headers);
            res.end(result.buffer);
        },
        error: err => {
            console.log('unhandled error was thrown');
            console.error(err)
        },
        complete: () => {
            console.log('response completed');
        }
    });

});

function getResizedImageAsBuffer() {
    return file => new Observable(o$ => {
        o$.next(sharp(file)
            .resize(500, 700, {
                fit: 'contain'
            })
            .rotate()
            .toBuffer());
        o$.complete();
    }).pipe(
        switchMap(prom => from(prom as Promise<Buffer>)),
        map(buffer => {
            return {
                file,
                buffer
            }
        })
    );
}

function retryCondition(errors$) {
    return errors$.pipe(
        concatMap((err, i) =>
            iif(
                () => i + 1 >= ALLOWED_RETRIES,
                throwError(err),
                of(err)
                    .pipe(
                        tap(t => {
                            console.log(`retrying ${i + 1}. time`);
                        }),
                        // delay(2000)
                    )
            )
        )
    );
}

function addImageNameHeader(file: string, headers: any) {
    const safeRootFolder = ROOT_FOLDER.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regExp = new RegExp(safeRootFolder + "\\\\(.*)\\\\(.*)");
    const matches = regExp.exec(file);
    if (matches !== null && matches.length > 0) {
        headers = {
            ...headers,
            'X-Image-Name': matches[1]
        };
    }
    return headers;
}

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`)
});

recursive(TARGET_FOLDER,
    [(file, stats) => !isImage(file)],
    function (err, files) {
        console.log(JSON.stringify(files, null, 4));
        cache.set(CACHE_KEY, new CacheRecord(files), 120);
    });