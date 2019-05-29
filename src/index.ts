import * as express from 'express';
import * as NodeCache from 'node-cache'
import * as recursive from 'recursive-readdir'
import * as sharp from 'sharp'
import * as exif from 'exif'
import * as cors from 'cors';
import {EMPTY, from, iif, Observable, of, throwError} from "rxjs";
import {catchError, concatMap, finalize, map, retryWhen, switchMap, tap, timeout} from "rxjs/operators";
import {CacheRecord} from "./cacheRecord";
import {addImageDateHeader, addImageNameHeader, extensionHeaders} from "./headerExtensions";

require('console-stamp')(console);
const isImage = require('is-image');
// const readChunk = require('read-chunk');
const imageType = require('image-type');

const PORT = process.env.PORT || 3000;
const ROOT_FOLDER = process.env.ROOT_FOLDER || '\\\\DISKSERVER\\Photo';
const TARGET_FOLDER = process.env.TARGET_FOLDER || ROOT_FOLDER + '\\2019 Cestovanie - Macao';
// const TARGET_FOLDER = process.env.TARGET_FOLDER || ROOT_FOLDER + '';
const RESIZE_WIDTH = parseInt(process.env.RESIZE_WIDTH) || 500;

const ALLOWED_RETRIES = 5;
const RESPONSE_TIMEOUT = 5000;
const CACHE_REFRESH_THRESHOLD = 155;
const CACHE_KEY = 'cache';

const app = express();
const cache = new NodeCache();

app.use(cors({
    exposedHeaders: extensionHeaders
}));

app.get("/random", (req, res) => {

    const cached = cache.get(CACHE_KEY) as CacheRecord;

    if (!cached || !cached.hasRecords()) {
        console.log(`returning 404 due to empty cache`);
        res.writeHead(404, {'Content-Type': 'text/html'});
        res.end(`no items to serve`);
        return;
    }

    new Observable(o$ => {
        o$.next(cached.random());
        o$.complete();
    }).pipe(
        concatMap(getResizedImageAsBuffer),
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
            if (cached && cached.remaining() < CACHE_REFRESH_THRESHOLD) {
                refreshCache();
            }
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
            headers = addImageDateHeader((result as any).exif, headers);
            headers = addImageNameHeader(ROOT_FOLDER, result.file as string, headers);
            res.writeHead(200, headers);
            res.end(result.buffer);
        },
        error: err => console.error('unhandled error was thrown', err),
        // complete: () => {
        //     console.log('response completed');
        // }
    });

});

function getResizedImageAsBuffer(file: string) {
    return new Observable(o$ => {
        o$.next(sharp(file)
            .resize(RESIZE_WIDTH)
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

async function refreshCache() {
    console.log('refreshing cache');
    console.log(`scanning folder ${TARGET_FOLDER}. This may take a while ...`);
    const files = await recursive(TARGET_FOLDER,
        [(file, stats) => {
            return !isImage(file) && !stats.isDirectory() && !file.includes('__thumb');
        }]);
    cache.set(CACHE_KEY, new CacheRecord(files), 3600 * 24);
    console.log('cache refreshed');
}

(async () => {
    await refreshCache();
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`)
    });
})().catch(err => {
    console.error('unrecoverable error', err);
    process.exit(1);
});