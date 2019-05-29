export class CacheRecord {

    constructor(private records: string[]) {
        console.log(`constructed cache with ${records.length} items`)
    }

    public random(): string {
        console.log(`popping random item from cache with ${this.records.length} items`);
        if (!this.hasRecords()) {
            console.warn(`cache is empty!`);
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