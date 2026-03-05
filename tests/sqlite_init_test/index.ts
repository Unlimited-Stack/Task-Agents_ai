import Database from 'better-sqlite3';

// 1. 创建并连接数据库（如果文件不存在，会自动创建）
const db = new Database('my_database.db', { verbose: console.log });

// 2. 创建一个表
const createTable = `
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`;
db.exec(createTable);

// 3. 准备插入数据的语句
const insert = db.prepare('INSERT INTO users (name, email) VALUES (?, ?)');

// 4. 执行插入（使用事务以确保安全）
const insertMany = db.transaction((users: {name: string, email: string}[]) => {
  for (const user of users) insert.run(user.name, user.email);
});

try {
    insertMany([
        { name: 'Alice', email: 'alice@example.com' },
        { name: 'Bob', email: 'bob@example.com' }
    ]);
} catch (err) {
    console.log("数据可能已存在，跳过插入。");
}

// 5. 查询数据
const rows = db.prepare('SELECT * FROM users').all();
console.table(rows);

// 关闭连接
db.close();