// Fausse base MongoDB en mémoire pour les tests et les essais sans Atlas.
// load(cheminServeur) charge le vrai server.js en remplaçant les modules externes.
const Module = require('module');

function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if (cond.$gte !== undefined && !(doc[key] >= cond.$gte)) return false;
      if (cond.$lte !== undefined && !(doc[key] <= cond.$lte)) return false;
      return true;
    }
    return doc[key] === cond;
  });
}
function project(doc, options) {
  if (!doc) return null;
  const copy = structuredClone(doc);
  const projection = options && options.projection;
  if (projection && projection._id === 0) delete copy._id;
  return copy;
}

class FakeCollection {
  constructor(name) { this.collectionName = name; this.docs = []; }
  find(filter = {}, options) {
    const results = this.docs.filter(d => matches(d, filter)).map(d => project(d, options));
    const cursor = { sort() { return cursor; }, toArray: async () => results };
    return cursor;
  }
  async findOne(filter, options) { return project(this.docs.find(d => matches(d, filter)), options); }
  async countDocuments(filter = {}) { return this.docs.filter(d => matches(d, filter)).length; }
  async insertOne(doc) { this.docs.push({ _id: this.docs.length + 1, ...doc }); }
  async insertMany(docs) { docs.forEach(d => this.docs.push({ _id: this.docs.length + 1, ...d })); }
  async updateOne(filter, update) {
    const doc = this.docs.find(d => matches(d, filter));
    if (doc) Object.assign(doc, update.$set);
  }
  async findOneAndUpdate(filter, update, options = {}) {
    let doc = this.docs.find(d => matches(d, filter));
    if (!doc) {
      if (!options.upsert) return null;
      doc = { _id: this.docs.length + 1, ...filter, ...(update.$setOnInsert || {}) };
      this.docs.push(doc);
    }
    Object.assign(doc, update.$set || {});
    for (const [key, by] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + by;
    return project(doc, options);
  }
  async deleteOne(filter) {
    const index = this.docs.findIndex(d => matches(d, filter));
    if (index < 0) return { deletedCount: 0 };
    this.docs.splice(index, 1);
    return { deletedCount: 1 };
  }
  async deleteMany(filter = {}) {
    const before = this.docs.length;
    this.docs = this.docs.filter(d => !matches(d, filter));
    return { deletedCount: before - this.docs.length };
  }
  async createIndex() {}
}

function createFakeDb() {
  const collections = {};
  const state = { down: false };
  const database = {
    collection: name => (collections[name] ||= new FakeCollection(name)),
    command: async () => { if (state.down) throw new Error('base injoignable'); return { ok: 1 }; }
  };
  const mongodb = { MongoClient: class { async connect() {} db() { return database; } } };
  return { mongodb, collections, state, database };
}

// Charge server.js avec la fausse base ; `webPush` remplace l'envoi réel des notifications si fourni
function loadServer(serverPath, { env = {}, webPush } = {}) {
  const fake = createFakeDb();
  Object.assign(process.env, { MONGODB_URI: 'mongodb://fake', ...env });
  const original = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'mongodb') return fake.mongodb;
    if (request === 'web-push' && webPush) return webPush;
    return original.call(this, request, ...rest);
  };
  delete require.cache[require.resolve(serverPath)];
  const app = require(serverPath);
  return { app, ...fake };
}

module.exports = { loadServer, createFakeDb };
