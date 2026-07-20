"use strict";

/// File IO

const typeReg = "file";
const typeDir = "dir";

class DirEnt {
    constructor(name, id) {
        this.name = name;
        this.id = id;
    }
}

class Perm {
    constructor(read, write, execute) {
        this.r = read;
        this.w = write;
        this.x = execute;
    }
    toString() {
        return `${this.r ? "r" : "-"}${this.w ? "w" : "-"}${this.x ? "x" : "-"}`
    }
}

class Mode {
    constructor(userPerm, groupPerm, worldPerm) {
        this.userPerm = userPerm;
        this.groupPerm = groupPerm;
        this.worldPerm = worldPerm;
    }
    toString() {
        return `${this.userPerm.toString()}${this.groupPerm.toString()}${this.worldPerm.toString()}`
    }
}

class Inode {
    constructor(id, type, mode, uid, gid) {
        this.id = id;
        this.type = type;
        this.uid = uid;
        this.gid = gid;
        this.mode = mode;
        this.contents = ""
    }
    size() {
        return this.contents.length
    }
}

const defaultMode = new Mode(
    new Perm(true, true, true),
    new Perm(true, false, true),
    new Perm(true, false, true)
)

// test kv is just an object
const rootInode = new Inode(0, typeDir, defaultMode, 0, 0);
rootInode.contents = "[]";
const mockKV = {
    0: rootInode,
};
let nextInodeId = 1;

// at is an optional parameter
function getInode(uid, gid, path, at) {
    if (path[0] != "/" && at === undefined) {
        throw `cannot read ${path}: not absolute and no "at"`;
    }
    const root = getInodeKV(at ? at : 0); // start at or root is always 0

    if (!permCheck(uid, gid, root, new Perm(true, false, true))) {
        throw `cannot read/execute at path root ${root}`;
    }
    if (root.type != typeDir) {
        throw `cannot read dir ${path}, not a directory. type ${root.type}`;
    }

    const sp = splitPath(path);
    let inode = root;
    for (const nameIdx in sp) {
        const name = sp[nameIdx];
        const last = nameIdx === sp.length-1;

        if (last || !permCheck(uid, gid, inode, new Perm(true, false, true))) {
            throw `cannot read/execute at path ${path}`;
        }
        if (last || inode.type != typeDir) {
            throw `cannot read dir ${path}, not a directory. type ${root.type}`;
        }

        const dirEnts = readDir(inode);
        const match = dirEnts.find(e => e.name === name);
        if (!match) {
            throw `no file or directory: ${name} in ${path}`;
        }
        inode = getInodeKV(match.id);
    }

    return inode;
}

function permCheck(uid, gid, inode, wantPerm) {
    let canR = false;
    let canW = false;
    let canX = false;

    if (uid === inode.uid) {
        canR = inode.mode.userPerm.r;
        canW = inode.mode.userPerm.w;
        canX = inode.mode.userPerm.x;
    }
    if (gid === inode.gid) {
        canR ||= inode.mode.groupPerm.r;
        canW ||= inode.mode.groupPerm.w;
        canX ||= inode.mode.groupPerm.x;
    }
    canR ||= inode.mode.worldPerm.r;
    canW ||= inode.mode.worldPerm.w;
    canX ||= inode.mode.worldPerm.x;

    let goodR = wantPerm.r ? canR : true;
    let goodW = wantPerm.w ? canW : true;
    let goodX = wantPerm.x ? canX : true;

    return goodR && goodW && goodX;
}

function readDir(inode) {
    return JSON.parse(inode.contents)
}

function writeDir(inode, dirEnts) {
    inode.contents = JSON.stringify(dirEnts)
}

function mkdir(uid, gid, mode, path, at) {
    const base = basename(path);
    const dir = dirname(path);
    const parentInode = getInode(uid, gid, dir, at);
    if (!permCheck(uid, gid, parentInode, new Perm(false, true, false))) {
        throw `permission denied: cannot write to ${path}`;
    }
    if (parentInode.type != typeDir) {
        throw `cannot create a directory under a file`;
    }
    let dirEnts = readDir(parentInode);
    if (dirEnts.find(e => e.name === base)) {
        throw `directory already exists: ${path}`;
    }

    const newDirInode = new Inode(nextInodeId++, typeDir, mode, uid, gid);
    newDirInode.contents = "[]";
    putInodeKV(newDirInode.id, newDirInode);

    dirEnts.unshift(new DirEnt(base, newDirInode.id));
    writeDir(parentInode, dirEnts);
}

// split path into pieces
function splitPath(path) {
    if (path.includes("\n")) {
        throw `invalid path contains newline`;
    }
    return path.split("/").filter(e => e.length);
}

function basename(path) {
    const sp = splitPath(path);
    return sp[sp.length-1];
}

function dirname(path) {
    const first = path[0] === "/" ? "/" : "";
    const sp = splitPath(path);
    return first + sp.slice(0, sp.length-1).join("/");
}

function write(uid, gid, contents, path, at) {
    const inode = getInode(uid, gid, path, at);
    if (inode.type !== typeReg) {
        throw `cannot write to ${inode.type}`;
    }
    if (!permCheck(uid, gid, inode, new Perm(false, true, false))) {
        throw `permission denied: cannot write to ${path}`;
    }

    inode.contents = contents;
}

function read(uid, gid, path, at) {
    const inode = getInode(uid, gid, path, at);
    if (inode.type !== typeReg) {
        throw `cannot read ${inode.type}`;
    }
    if (!permCheck(uid, gid, inode, new Perm(true, false, false))) {
        throw `permission denied: cannot read ${path}`;
    }

    return inode.contents;
}

function create(uid, gid, mode, path, at) {
    const base = basename(path);
    const dir = dirname(path);
    console.log("create base", base);
    console.log("create dir", dir);
    const parentInode = getInode(uid, gid, dir, at);
    if (!permCheck(uid, gid, parentInode, new Perm(false, true, false))) {
        throw `permission denied: cannot write to dir ${path}`
    }
    if (parentInode.type !== typeDir) {
        throw `cannot create node under ${parentInode.type}`;
    }

    let dirEnts = readDir(parentInode);
    if (dirEnts.find(e => e.name === base)) {
        throw `file already exists: ${path}`;
    }

    const newInode = new Inode(nextInodeId++, typeReg, mode, uid, gid);
    putInodeKV(newInode.id, newInode);

    dirEnts.unshift(new DirEnt(base, newInode.id));
    writeDir(parentInode, dirEnts);
}

function getInodeKV(id) {
    return mockKV[id];
}

function putInodeKV(id, inode) {
    mockKV[id] = inode;
}

function resolvePath(cwd, path) {
    if (path[0] === "/") {
        return resolvePathDots(path);
    }
    if (cwd === "/") {
        return resolvePathDots("/"+path);
    }
    return resolvePathDots(cwd+"/"+path);
}

function resolvePathDots(path) {
    console.log("resolvePathDots", path);
    const first = path[0] === "/" ? "/" : "";
    const sp = splitPath(path);
    while (sp.includes("..")) {
        const dd = sp.indexOf("..");
        if (dd !== 0) {
            sp.splice(dd-1, 2);
        } else {
            sp.shift();
        }
    }
    return first+sp.filter(e => e !== ".").join("/");
}

/// Shell
class Shell {
    constructor() {
        this.env = {};
        this.uid = 0;
        this.gid = 0;
        this.cwd = "/";
        this.at = 0;
        this.input = "";
        this.output = "";
        this.args = [];
    }
    eval(input) {
        this.env.pwd = this.cwd;
        this.output = "";
        this.input = input;
        this.args = splitToArgs(this.input, this.env);
        switch(this.args[0]) {
        case "env":
            for (const e in this.env) {
                this.output += `${e}=${this.env[e]}\n`;
            }
            break;
        case "ls": {
            const inode = getInode(this.uid, this.gid, this.cwd);
            const dir = readDir(inode);
            for (const f of dir) {
                const i = getInodeKV(f.id);
                this.output += `${i.type === typeDir ? "d" : " "}${i.mode.toString()} ${i.uid} ${i.gid} ${i.size()} ${f.name}\n`;
            }
            break;
        }
        case "cd": {
            const path = this.args[1];
            this.cd(path);
            break;
        }
        case "cat": {
            const path = resolvePath(this.cwd, this.args[1]);
            this.output = read(this.uid, this.gid, path);
            break;
        }
        case "mkdir": {
            const path = resolvePath(this.cwd, this.args[1]);
            mkdir(this.uid, this.gid, defaultMode, path);
            break;
        }
        case "pwd": {
            this.output = this.cwd;
            break;
        }
        case "echo": {
            this.output = this.args.slice(1).join(" ");
            break;
        }
        case "realpath": {
            const path = resolvePath(this.cwd, this.args[1]);
            this.output = path;
            break;
        }
        default:
            throw `command not found "${this.args[0]}"`;
            break;
        }
    }
    cd(path) {
        const newPath = resolvePath(this.cwd, path);
        const inode = getInode(this.uid, this.gid, newPath);
        if (inode.type !== typeDir) {
            throw `cannot change to ${path}: type ${inode.type}`;
        }
        this.cwd = newPath;
        this.at = inode.id;
    }
}

function splitToArgs(input, env) {
    // Regex matches double-quoted strings, single-quoted strings, or unquoted text
    const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^\s']+)/g;
    const matches = [...input.matchAll(regex)];

    return matches.map(match => {
        if (match[1] !== undefined) return substituteShellVariables(match[1].replace(/\\"/g, '"'), env); // Double quoted
        if (match[2] !== undefined) return match[2].replace(/\\'/g, "'"); // Single quoted
        return substituteShellVariables(match[3], env); // Unquoted
    });
}

function substituteShellVariables(inputString, env) {
    // Regex to match either ${VAR} or $VAR
    const regex = /\$(?:\{([\w-]+)\}|([\w-]+))/g;

    return inputString.replace(regex, (match, bracedName, plainName) => {
        // Determine which capture group caught the variable name
        const varName = bracedName || plainName;

        // Look up the value in the environment object
        // If found, return it. If not, keep the original match text (or use '')
        return varName in env ? env[varName] : match;
    });
}


console.log(getInode(0, 0, "/"));
mkdir(0, 0, defaultMode, "/hee");
create(0, 0, defaultMode, "/hee/another");
write(0, 0, "another one", "/hee/another");
console.log(getInode(0, 0, "/"));
create(0, 0, defaultMode, "/frog");
console.log(getInode(0, 0, "/"));
console.log(mockKV);
write(0, 0, "test", "/frog");
console.log(read(0, 0, "/frog"));

const shell = new Shell();

// node specific
const rl = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.prompt();

// Fires every time a newline character (\n) is detected
rl.on('line', (line) => {
    try {
        shell.eval(line);
    } catch (e) {
        console.error(e);
    }
    console.log(shell.output);
    rl.prompt();
});
