"use strict";

var ENVIRONMENT_IS_NODE = typeof process === 'object' && typeof require === 'function';
var ENVIRONMENT_IS_WEB = typeof window === 'object';
var ENVIRONMENT_IS_WORKER = typeof importScripts === 'function';

// WebAssembly module cache
// TODO: leaks memory even when disabled...
var _WASM_module_cache = {};
var CACHE_WASM_MODULES = true;
function getWASMModule(module_id) {
  var module = _WASM_module_cache[module_id];
  if (!module) {
    starttime();
    module = new WebAssembly.Module(wasmBlob[module_id]);
    if (CACHE_WASM_MODULES) {
      _WASM_module_cache[module_id] = module;
      delete wasmBlob[module_id];
    }
    endtime("module creation " + module_id);
  }
  return module;
}
// function for use with instantiateWasm
function moduleInstFn(module_id) {
  return function(imports,ri) {
    var mod = getWASMModule(module_id);
    var inst = new WebAssembly.Instance(mod, imports);
    ri(inst);
    return inst.exports;
  }
}

var PLATFORM_PARAMS = {
  'mw8080bw': {
    code_start: 0x0,
    rom_size: 0x2000,
    data_start: 0x2000,
    data_size: 0x400,
    stack_end: 0x2400,
  },
  'vicdual': {
    code_start: 0x0,
    rom_size: 0x4020,
    data_start: 0xe400,
    data_size: 0x400,
    stack_end: 0xe800,
  },
  'galaxian': {
    code_start: 0x0,
    rom_size: 0x4000,
    data_start: 0x4000,
    data_size: 0x400,
    stack_end: 0x4800,
  },
  'galaxian-scramble': {
    code_start: 0x0,
    rom_size: 0x5020,
    data_start: 0x4000,
    data_size: 0x400,
    stack_end: 0x4800,
  },
  'williams-z80': {
    code_start: 0x0,
    rom_size: 0x9800,
    data_start: 0x9800,
    data_size: 0x2800,
    stack_end: 0xc000,
  },
  'vector-z80color': {
    code_start: 0x0,
    rom_size: 0x8000,
    data_start: 0xe000,
    data_size: 0x2000,
    stack_end: 0x0,
  },
  'sound_williams-z80': {
    code_start: 0x0,
    rom_size: 0x4000,
    data_start: 0x4000,
    data_size: 0x400,
    stack_end: 0x8000,
  },
  'base_z80': {
    code_start: 0x0,
    rom_size: 0x8000,
    data_start: 0x8000,
    data_size: 0x8000,
    stack_end: 0x0,
  },
  'coleco': {
    rom_start: 0x8000,
    code_start: 0x8100,
    rom_size: 0x8000,
    data_start: 0x7000,
    data_size: 0x400,
    stack_end: 0x8000,
    extra_preproc_args: ['-I', '/share/include/coleco'],
    extra_link_args: ['-k', '/share/lib/coleco',
      '-l', 'libcv', '-l', 'libcvu', 'crt0.rel', //'/share/lib/coleco/crt0.rel',
      //'-l', 'comp.lib', '-l', 'cvlib.lib', '-l', 'getput.lib', '/share/lib/coleco/crtcv.rel',
      //'main.rel'
      ],
  },
  'nes': { //TODO
    define: '__NES__',
    cfgfile: 'neslib.cfg',
    libargs: ['crt0.o', 'nes.lib', 
      '-D', 'NES_MAPPER=0',
      '-D', 'NES_PRG_BANKS=2',
      '-D', 'NES_CHR_BANKS=0', // TODO: >0 doesn't seem to work
      '-D', 'NES_MIRRORING=0',
      ],
    extrafiles: ['crt0.o'],
  },
  'nes-conio': {
    cfgfile: 'nes.cfg',
    define: '__NES__',
    libargs: ['nes.lib'],
  },
  'nes-lib': {
    define: '__NES__',
    cfgfile: 'neslib.cfg',
    libargs: ['neslib.lib', 'nes.lib'],
  },
  'apple2': {
    define: '__APPLE2__',
    cfgfile: 'apple2-hgr.cfg',
    libargs: ['apple2.lib'],
    __CODE_RUN__: 16384,
  },
  'apple2-e': {
    define: '__APPLE2__',
    cfgfile: 'apple2.cfg',
    libargs: ['apple2.lib'],
  },
  'atari8-800': {
    define: '__ATARI__',
    cfgfile: 'atari-cart.cfg',
    libargs: ['atari.lib'],
  },
  'atari8-5200': {
    define: '__ATARI5200__',
    cfgfile: 'atari5200.cfg',
    libargs: ['atari5200.lib'],
  },
  'c64': {
    define: '__C64__',
    cfgfile: 'c64.cfg',
    libargs: ['c64.lib'],
  },
  'verilog': {
  },
};

// shim out window and document objects for security
// https://github.com/mbostock/d3/issues/1053
var noop = function() { return new Function(); };
var window = noop();
window.CSSStyleDeclaration = noop();
window.CSSStyleDeclaration.setProperty = noop();
window.Element = noop();
window.Element.setAttribute = noop();
window.Element.setAttributeNS = noop();
window.navigator = noop();
var document = noop();
document.documentElement = noop();
document.documentElement.style = noop();

var _t1;
function starttime() { _t1 = new Date(); }
function endtime(msg) { var _t2 = new Date(); console.log(msg, _t2.getTime() - _t1.getTime(), "ms"); }

/// working file store and build steps

var buildsteps = [];
var buildstartseq = 0;
var workfs = {};
var workerseq = 0;

function compareData(a,b) {
  if (a.length != b.length) return false;
  if (typeof a === 'string' && typeof b === 'string')
    return a==b;
  else {
    for (var i=0; i<a.length; i++) {
      //if (a[i] != b[i]) console.log('differ at byte',i,a[i],b[i]);
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}

function putWorkFile(path, data) {
  var encoding = (typeof data === 'string') ? 'utf8' : 'binary';
  var entry = workfs[path];
  if (!entry || !compareData(entry.data, data) || entry.encoding != encoding) {
    workfs[path] = entry = {path:path, data:data, encoding:encoding, ts:++workerseq};
    console.log('+++', entry.path, entry.encoding, entry.data.length, entry.ts);
  }
  return entry;
}

// returns true if file changed during this build step
function wasChanged(entry) {
  return entry.ts > buildstartseq;
}

function populateEntry(fs, path, entry) {
  fs.writeFile(path, entry.data, {encoding:entry.encoding});
  fs.utime(path, entry.ts, entry.ts);
  console.log("<<<", path, entry.data.length);
}

// can call multiple times (from populateFiles)
function gatherFiles(step, options) {
  var maxts = 0;
  if (step.files) {
    for (var i=0; i<step.files.length; i++) {
      var path = step.files[i];
      var entry = workfs[path];
      maxts = Math.max(maxts, entry.ts);
    }
  }
  else if (step.code) {
    var path = step.path ? step.path : options.mainFilePath;
    if (!path) throw "need path or mainFilePath";
    var code = step.code;
    var entry = putWorkFile(path, code);
    step.path = path;
    step.files = [path];
    maxts = entry.ts;
  }
  else if (step.path) {
    var path = step.path;
    var entry = workfs[path];
    maxts = entry.ts;
    step.files = [path];
  }
  if (step.path && !step.prefix) {
    step.prefix = step.path.split(/[./]/)[0]; // TODO
  }
  step.maxts = maxts;
  return maxts;
}

function populateFiles(step, fs, options) {
  gatherFiles(step, options);
  if (!step.files) throw "call gatherFiles() first";
  for (var i=0; i<step.files.length; i++) {
    var path = step.files[i];
    populateEntry(fs, path, workfs[path]);
  }
}

function populateExtraFiles(step, fs) {
  // TODO: cache extra files
  var extrafiles = step.params.extrafiles;
  if (extrafiles) {
    for (var i=0; i<extrafiles.length; i++) {
      var xfn = extrafiles[i];
      var xpath = "lib/" + step.platform + "/" + xfn;
      var xhr = new XMLHttpRequest();
      xhr.responseType = 'arraybuffer';
      xhr.open("GET", xpath, false);  // synchronous request
      xhr.send(null);
      if (xhr.response && xhr.status == 200) {
        var data = new Uint8Array(xhr.response);
        fs.writeFile(xfn, data, {encoding:'binary'});
        console.log(":::",xfn,data.length);
      } else {
        throw Error("Could not load extra file " + xpath);
      }
    }
  }
}

function staleFiles(step, targets) {
  if (!step.maxts) throw "call populateFiles() first";
  // see if any target files are more recent than inputs
  for (var i=0; i<targets.length; i++) {
    var entry = workfs[targets[i]];
    if (!entry || step.maxts > entry.ts)
      return true;
  }
  console.log("unchanged", step.maxts, targets);
  return false;
}

function anyTargetChanged(step, targets) {
  if (!step.maxts) throw "call populateFiles() first";
  // see if any target files are more recent than inputs
  for (var i=0; i<targets.length; i++) {
    var entry = workfs[targets[i]];
    if (!entry || entry.ts > step.maxts)
      return true;
  }
  console.log("unchanged", step.maxts, targets);
  return false;
}

function execMain(step, mod, args) {
  starttime();
  mod.callMain(args);
  endtime(step.tool);
}

/// asm.js / WASM / filesystem loading

var fsMeta = {};
var fsBlob = {};
var wasmBlob = {};

// load filesystems for CC65 and others asynchronously
function loadFilesystem(name) {
  var xhr = new XMLHttpRequest();
  xhr.responseType = 'blob';
  xhr.open("GET", "fs/fs"+name+".data", false);  // synchronous request
  xhr.send(null);
  fsBlob[name] = xhr.response;
  xhr = new XMLHttpRequest();
  xhr.responseType = 'json';
  xhr.open("GET", "fs/fs"+name+".js.metadata", false);  // synchronous request
  xhr.send(null);
  fsMeta[name] = xhr.response;
  console.log("Loaded "+name+" filesystem", fsMeta[name].files.length, 'files', fsBlob[name].size, 'bytes');
}

var loaded = {}
function load(modulename, debug) {
  if (!loaded[modulename]) {
    importScripts('asmjs/'+modulename+(debug?"."+debug+".js":".js"));
    loaded[modulename] = 1;
  }
}
function loadGen(modulename) {
  if (!loaded[modulename]) {
    importScripts('../../gen/'+modulename+".js");
    loaded[modulename] = 1;
  }
}
function loadWASM(modulename, debug) {
  if (!loaded[modulename]) {
    importScripts("wasm/" + modulename+(debug?"."+debug+".js":".js"));
    var xhr = new XMLHttpRequest();
    xhr.responseType = 'arraybuffer';
    xhr.open("GET", "wasm/"+modulename+".wasm", false);  // synchronous request
    xhr.send(null);
    if (xhr.response) {
      wasmBlob[modulename] = new Uint8Array(xhr.response);
      console.log("Loaded " + modulename + ".wasm");
      loaded[modulename] = 1;
    } else {
      throw Error("Could not load WASM file " + modulename + ".wasm");
    }
  }
}
function loadNative(modulename, debug) {
  // detect WASM
  if (CACHE_WASM_MODULES && typeof WebAssembly === 'object') {
    loadWASM(modulename);
  } else {
    load(modulename);
  }
}

// mount the filesystem at /share
function setupFS(FS, name) {
  var WORKERFS = FS.filesystems['WORKERFS']
  FS.mkdir('/share');
  FS.mount(WORKERFS, {
    packages: [{ metadata: fsMeta[name], blob: fsBlob[name] }]
  }, '/share');
  // fix for slow Blob operations by caching typed arrays
  // https://github.com/kripken/emscripten/blob/incoming/src/library_workerfs.js
  var reader = WORKERFS.reader;
  var blobcache = {};
  WORKERFS.stream_ops.read = function (stream, buffer, offset, length, position) {
    if (position >= stream.node.size) return 0;
    var contents = blobcache[stream.path];
    if (!contents) {
      var ab = reader.readAsArrayBuffer(stream.node.contents);
      contents = blobcache[stream.path] = new Uint8Array(ab);
    }
    if (position + length > contents.length)
      length = contents.length - position;
    for (var i=0; i<length; i++) {
      buffer[offset+i] = contents[position+i];
    }
    return length;
  };
}

var print_fn = function(s) {
  console.log(s);
  //console.log(new Error().stack);
}

// test.c(6) : warning 85: in function main unreferenced local variable : 'x'
// main.a (4): error: Unknown Mnemonic 'xxx'.
// at 2: warning 190: ISO C forbids an empty source file
var re_msvc  = /[/]*([^( ]+)\s*[(](\d+)[)]\s*:\s*(.+?):\s*(.*)/;
var re_msvc2 = /\s*(at)\s+(\d+)\s*(:)\s*(.*)/;

function msvcErrorMatcher(errors) {
  return function(s) {
    var matches = re_msvc.exec(s) || re_msvc2.exec(s);
    if (matches) {
      var errline = parseInt(matches[2]);
      errors.push({
        line:errline,
        path:matches[1],
        type:matches[3],
        msg:matches[4]
      });
    } else {
      console.log(s);
    }
  }
}

function makeErrorMatcher(errors, regex, iline, imsg, path) {
  return function(s) {
    var matches = regex.exec(s);
    if (matches) {
      errors.push({
        line:parseInt(matches[iline]) || 1,
        msg:matches[imsg],
        path:path
      });
    } else {
      console.log("??? "+s);
    }
  }
}

function extractErrors(regex, strings, path) {
  var errors = [];
  var matcher = makeErrorMatcher(errors, regex, 1, 2, path);
  for (var i=0; i<strings.length; i++) {
    matcher(strings[i]);
  }
  return errors;
}

// TODO: "of" doesn't work in MSIE

function parseListing(code, lineMatch, iline, ioffset, iinsns, origin) {
  var lines = [];
  origin |= 0;
  for (var line of code.split(/\r?\n/)) {
    var linem = lineMatch.exec(line);
    if (linem && linem[1]) {
      var linenum = parseInt(linem[iline]);
      var offset = parseInt(linem[ioffset], 16);
      var insns = linem[iinsns];
      if (insns) {
        lines.push({
          line:linenum,
          offset:offset + origin,
          insns:insns,
        });
      }
    }
  }
  return lines;
}

function parseSourceLines(code, lineMatch, offsetMatch, origin) {
  var lines = [];
  var lastlinenum = 0;
  origin |= 0;
  for (var line of code.split(/\r?\n/)) {
    var linem = lineMatch.exec(line);
    if (linem && linem[1]) {
      lastlinenum = parseInt(linem[1]);
    } else if (lastlinenum) {
      var linem = offsetMatch.exec(line);
      if (linem && linem[1]) {
        var offset = parseInt(linem[1], 16);
        lines.push({
          line:lastlinenum,
          offset:offset + origin,
        });
        lastlinenum = 0;
      }
    }
  }
  return lines;
}

function parseDASMListing(code, unresolved, mainFilename) {
  //        4  08ee		       a9 00	   start      lda	#01workermain.js:23:5
  var lineMatch = /\s*(\d+)\s+(\S+)\s+([0-9a-f]+)\s+([?0-9a-f][?0-9a-f ]+)?\s+(.+)?/i;
  var equMatch = /\bequ\b/i;
  var macroMatch = /\bMAC\s+(.+)?/i;
  var errors = [];
  var lines = [];
  var macrolines = [];
  var lastline = 0;
  var macros = {};
  for (var line of code.split(/\r?\n/)) {
    var linem = lineMatch.exec(line);
    if (linem && linem[1]) {
      var linenum = parseInt(linem[1]);
      var filename = linem[2];
      var offset = parseInt(linem[3], 16);
      var insns = linem[4];
      var restline = linem[5];
      if (insns && insns.startsWith('?')) insns = null;
      // inside of main file?
      if (filename == mainFilename) {
        // look for MAC statement
        var macmatch = macroMatch.exec(restline);
        if (macmatch) {
          macros[macmatch[1]] = {line:parseInt(linem[1]), file:linem[2].toLowerCase()};
        }
        else if (insns && !restline.match(equMatch)) {
          lines.push({
            line:linenum,
            offset:offset,
            insns:insns,
            iscode:restline[0] != '.'
          });
        }
        lastline = linenum;
      } else {
        // inside of macro or include file
        if (insns && linem[3] && lastline>0) {
          lines.push({
            line:lastline+1,
            offset:offset,
            insns:null
          });
        }
        // inside of macro?
        var mac = macros[filename.toLowerCase()];
        if (insns && mac) {
          macrolines.push({
            filename:mac.file,
            line:mac.line+linenum,
            offset:offset,
            insns:insns
          });
        }
      }
      // TODO: better symbol test (word boundaries)
      // TODO: ignore IFCONST and IFNCONST usage
      for (var key in unresolved) {
        var pos = restline ? restline.indexOf(key) : line.indexOf(key);
        if (pos >= 0) {
          errors.push({
            path:filename,
            line:linenum,
            msg:"Unresolved symbol '" + key + "'"
          });
        }
      }
    }
    var errm = re_msvc.exec(line);
    if (errm) {
      errors.push({
        path:errm[1],
        line:parseInt(errm[2]),
        msg:errm[4]
      })
    }
  }
  // TODO: use macrolines
  // TODO: return {text:code, asmlines:lines, macrolines:macrolines, errors:errors};
  return {lines:lines, macrolines:macrolines, errors:errors};
}

function assembleDASM(step) {
  load("dasm");
  var re_usl = /(\w+)\s+0000\s+[?][?][?][?]/;
  var unresolved = {};
  var errors = [];
  function match_fn(s) {
    var matches = re_usl.exec(s);
    if (matches) {
      var key = matches[1];
      if (key != 'NO_ILLEGAL_OPCODES') { // TODO
        unresolved[matches[1]] = 0;
      }
    } else if (s.startsWith("Warning:")) {
      errors.push({line:1, msg:s.substr(9)});
    }
  }
  var Module = DASM({
    noInitialRun:true,
    print:match_fn
  });
  var FS = Module['FS'];
  populateFiles(step, FS, {
    mainFilePath:'main.a'
  });
  var binpath = step.prefix+'.bin';
  var lstpath = step.prefix+'.lst';
  var sympath = step.prefix+'.sym';
  execMain(step, Module, [step.path, "-l"+lstpath, "-o"+binpath, "-s"+sympath ]);
  var alst = FS.readFile(lstpath, {'encoding':'utf8'});
  // parse main listing, get errors
  var listing = parseDASMListing(alst, unresolved, step.path);
  errors = errors.concat(listing.errors);
  if (errors.length) {
    return {errors:errors};
  }
  var listings = {};
  listings[lstpath] = listing;
  // parse include files
  // TODO: kinda wasted effort
  for (var fn of step.files) {
    if (fn != step.path) {
      var lst = parseDASMListing(alst, unresolved, fn);
      listings[fn] = lst; // TODO: foo.asm.lst
    }
  }
  var aout = FS.readFile(binpath);
  var asym = FS.readFile(sympath, {'encoding':'utf8'});
  putWorkFile(binpath, aout);
  putWorkFile(lstpath, alst);
  putWorkFile(sympath, asym);
  // return unchanged if no files changed
  // TODO: what if listing or symbols change?
  if (!anyTargetChanged(step, [binpath/*, lstpath, sympath*/]))
    return;
  var symbolmap = {};
  for (var s of asym.split("\n")) {
    var toks = s.split(/\s+/);
    if (toks && toks.length >= 2 && !toks[0].startsWith('-')) {
      symbolmap[toks[0]] = parseInt(toks[1], 16);
    }
  }
  return {
    output:aout.slice(2),
    listings:listings,
    errors:errors,
    symbolmap:symbolmap,
  };
}

function setupStdin(fs, code) {
  var i = 0;
  fs.init(
    function() { return i<code.length ? code.charCodeAt(i++) : null; }
  );
}

    /*
    000000r 1               .segment        "CODE"
    000000r 1               ; int main() { return mul2(2); }
    000000r 1                       .dbg    line, "main.c", 3
    000000r 1  A2 00                ldx     #$00
    */
function parseCA65Listing(code, symbols, params, dbg) {
  var segofs = 0;
  // .dbg	line, "main.c", 1
  var segLineMatch = /[.]segment\s+"(\w+)"/;
  //var dbgLineMatch = /^([0-9A-F]+)([r]?)\s+(\d+)\s+[.]dbg\s+line,\s+\S+,\s+(\d+)/;
  var dbgLineMatch = /^([0-9A-F]+)([r]?)\s+(\d+)\s+[.]dbg\s+line,\s+"(\w+[.]\w+)", (\d+)/;
  var insnLineMatch = /^([0-9A-F]+)([r]?)\s+(\d+)\s+([0-9A-F][0-9A-F ]*[0-9A-F])\s+/;
  var lines = [];
  var linenum = 0;
  for (var line of code.split(/\r?\n/)) {
    linenum++;
    var segm = segLineMatch.exec(line);
    if (segm) {
      var segname = segm[1];
      var segsym = '__'+segname+'_RUN__';
      segofs = parseInt(symbols[segsym] || params[segsym]) || 0;
    }
    if (dbg) {
      var linem = dbgLineMatch.exec(line);
      if (linem && linem[1]) {
        var offset = parseInt(linem[1], 16);
        lines.push({
          // TODO: sourcefile
          line:parseInt(linem[5]),
          offset:offset + segofs,
          insns:null
        });
      }
    } else {
      var linem = insnLineMatch.exec(line);
      if (linem && linem[1]) {
        var offset = parseInt(linem[1], 16);
        var insns = linem[4].trim();
        if (insns.length) {
          lines.push({
            line:linenum,
            offset:offset + segofs,
            insns:insns
          });
        }
      }
    }
  }
  return lines;
}

function assembleCA65(step) {
  loadNative("ca65");
  var errors = [];
  gatherFiles(step, {mainFilePath:"main.s"});
  var objpath = step.prefix+".o";
  var lstpath = step.prefix+".lst";
  if (staleFiles(step, [objpath, lstpath])) {
    var objout, lstout;
    var CA65 = ca65({
      instantiateWasm: moduleInstFn('ca65'),
      noInitialRun:true,
      //logReadFiles:true,
      print:print_fn,
      printErr:msvcErrorMatcher(errors),
    });
    var FS = CA65['FS'];
    setupFS(FS, '65-'+step.platform.split('-')[0]);
    populateFiles(step, FS);
    execMain(step, CA65, ['-v', '-g', '-I', '/share/asminc', '-o', objpath, '-l', lstpath, step.path]);
    if (errors.length)
      return {errors:errors};
    objout = FS.readFile(objpath, {encoding:'binary'});
    lstout = FS.readFile(lstpath, {encoding:'utf8'});
    putWorkFile(objpath, objout);
    putWorkFile(lstpath, lstout);
  }
  return {
    linktool:"ld65",
    files:[objpath, lstpath],
    args:[objpath]
  };
}

function linkLD65(step) {
  loadNative("ld65");
  var params = step.params;
  var platform = step.platform;
  gatherFiles(step);
  var binpath = "main";
  if (staleFiles(step, [binpath])) {
    var errors = [];
    var errmsg = '';
    var LD65 = ld65({
      instantiateWasm: moduleInstFn('ld65'),
      noInitialRun:true,
      //logReadFiles:true,
      print:print_fn,
      printErr:function(s) { errmsg += s + '\n'; }
    });
    var FS = LD65['FS'];
    var cfgfile = '/' + platform + '.cfg';
    setupFS(FS, '65-'+platform.split('-')[0]);
    populateFiles(step, FS);
    populateExtraFiles(step, FS);
    var libargs = params.libargs;
    var args = ['--cfg-path', '/share/cfg',
      '--lib-path', '/share/lib',
      '--lib-path', '/share/target/apple2/drv', // TODO
      '-D', '__EXEHDR__=0', // TODO
      '-C', params.cfgfile,
      '-Ln', 'main.vice',
      //'--dbgfile', 'main.dbg',
      '-o', 'main', '-m', 'main.map'].concat(step.args, libargs);
    //console.log(args);
    execMain(step, LD65, args);
    if (errmsg.length)
      errors.push({line:0, msg:errmsg});
    if (errors.length)
      return {errors:errors};
    var aout = FS.readFile("main", {encoding:'binary'});
    var mapout = FS.readFile("main.map", {encoding:'utf8'});
    var viceout = FS.readFile("main.vice", {encoding:'utf8'});
    //var dbgout = FS.readFile("main.dbg", {encoding:'utf8'});
    putWorkFile("main", aout);
    putWorkFile("main.map", mapout);
    putWorkFile("main.vice", viceout);
    // return unchanged if no files changed
    if (!anyTargetChanged(step, ["main", "main.map", "main.vice"]))
      return;
    // parse symbol map (TODO: omit segments, constants)
    var symbolmap = {};
    for (var s of viceout.split("\n")) {
      var toks = s.split(" ");
      if (toks[0] == 'al') {
        symbolmap[toks[2].substr(1)] = parseInt(toks[1], 16);
      }
    }
    // TODO: "of" in IE?
    var listings = {};
    for (var fn of step.files) {
      if (fn.endsWith('.lst')) {
        var lstout = FS.readFile(fn, {encoding:'utf8'});
        var asmlines = parseCA65Listing(lstout, symbolmap, params, false);
        var srclines = parseCA65Listing(lstout, symbolmap, params, true);
        putWorkFile(fn, lstout);
        listings[fn] = {
          asmlines:srclines.length ? asmlines : null,
          lines:srclines.length ? srclines : asmlines,
          text:lstout
        };
      }
    }
    return {
      output:aout, //.slice(0),
      listings:listings,
      errors:errors,
      symbolmap:symbolmap,
    };
  }
}

function compileCC65(step) {
  load("cc65");
  var params = step.params;
  // stderr
  var re_err1 = /.*?[(](\d+)[)].*?: (.+)/;
  var errors = [];
  var errline = 0;
  function match_fn(s) {
    console.log(s);
    var matches = re_err1.exec(s);
    if (matches) {
      errline = parseInt(matches[1]);
      errors.push({
        line:errline,
        msg:matches[2]
      });
    }
  }
  gatherFiles(step, {mainFilePath:"main.c"});
  var destpath = step.prefix + '.s';
  if (staleFiles(step, [destpath])) {
    var CC65 = cc65({
      noInitialRun:true,
      //logReadFiles:true,
      print:print_fn,
      printErr:match_fn,
    });
    var FS = CC65['FS'];
    setupFS(FS, '65-'+step.platform.split('-')[0]);
    populateFiles(step, FS);
    execMain(step, CC65, ['-T', '-g',
      '-Oirs',
      '-Cl', // static locals
      '-I', '/share/include',
      '-D' + params.define,
      step.path]);
    if (errors.length)
      return {errors:errors};
    var asmout = FS.readFile(destpath, {encoding:'utf8'});
    putWorkFile(destpath, asmout);
  }
  return {
    nexttool:"ca65",
    path:destpath,
    args:[destpath]
  };
}

function hexToArray(s, ofs) {
  var buf = new ArrayBuffer(s.length/2);
  var arr = new Uint8Array(buf);
  for (var i=0; i<arr.length; i++) {
    arr[i] = parseInt(s.slice(i*2+ofs,i*2+ofs+2), 16);
  }
  return arr;
}

function parseIHX(ihx, rom_start, rom_size) {
  var output = new Uint8Array(new ArrayBuffer(rom_size));
  for (var s of ihx.split("\n")) {
    if (s[0] == ':') {
      var arr = hexToArray(s, 1);
      var count = arr[0];
      var address = (arr[1]<<8) + arr[2] - rom_start;
      var rectype = arr[3];
      if (rectype == 0) {
        for (var i=0; i<count; i++) {
          var b = arr[4+i];
          output[i+address] = b;
        }
      } else if (rectype == 1) {
        return output;
      }
    }
  }
}

function assembleSDASZ80(step) {
  loadNative("sdasz80");
  var objout, lstout, symout;
  var errors = [];
  gatherFiles(step, {mainFilePath:"main.asm"});
  var objpath = step.prefix + ".rel";
  var lstpath = step.prefix + ".lst";
  if (staleFiles(step, [objpath, lstpath])) {
    //?ASxxxx-Error-<o> in line 1 of main.asm null
    //              <o> .org in REL area or directive / mnemonic error
    var match_asm_re = / <\w> (.+)/; // TODO
    function match_asm_fn(s) {
      var matches = match_asm_re.exec(s);
      if (matches) {
        //var errline = parseInt(matches[2]);
        errors.push({
          line:1, // TODO
          path:step.path,
          msg:matches[1]
        });
      }
    }
    var ASZ80 = sdasz80({
      instantiateWasm: moduleInstFn('sdasz80'),
      noInitialRun:true,
      //logReadFiles:true,
      print:match_asm_fn,
      printErr:match_asm_fn,
    });
    var FS = ASZ80['FS'];
    populateFiles(step, FS);
    execMain(step, ASZ80, ['-plosgffwy', step.path]);
    if (errors.length) {
      return {errors:errors};
    }
    objout = FS.readFile(objpath, {encoding:'utf8'});
    lstout = FS.readFile(lstpath, {encoding:'utf8'});
    putWorkFile(objpath, objout);
    putWorkFile(lstpath, lstout);
  }
  return {
    linktool:"sdldz80",
    files:[objpath, lstpath],
    args:[objpath]
  };
  //symout = FS.readFile("main.sym", {encoding:'utf8'});
}

function linkSDLDZ80(step)
{
  loadNative("sdldz80");
  var errors = [];
  gatherFiles(step);
  var binpath = "main.ihx";
  if (staleFiles(step, [binpath])) {
    //?ASlink-Warning-Undefined Global '__divsint' referenced by module 'main'
    var match_aslink_re = /\?ASlink-(\w+)-(.+)/;
    function match_aslink_fn(s) {
      var matches = match_aslink_re.exec(s);
      if (matches) {
        errors.push({
          line:0,
          msg:matches[2]
        });
      }
    }
    var params = step.params;
    var LDZ80 = sdldz80({
      instantiateWasm: moduleInstFn('sdldz80'),
      noInitialRun:true,
      //logReadFiles:true,
      print:match_aslink_fn,
      printErr:match_aslink_fn,
    });
    var FS = LDZ80['FS'];
    setupFS(FS, 'sdcc');
    populateFiles(step, FS);
    // TODO: coleco hack so that -u flag works
    if (step.platform == "coleco") {
      FS.writeFile('crt0.rel', FS.readFile('/share/lib/coleco/crt0.rel', {encoding:'utf8'}));
      FS.writeFile('crt0.lst', '\n'); // TODO: needed so -u flag works
    }
    var args = ['-mjwxyu',
      '-i', 'main.ihx', // TODO: main?
      '-b', '_CODE=0x'+params.code_start.toString(16),
      '-b', '_DATA=0x'+params.data_start.toString(16),
      '-k', '/share/lib/z80',
      '-l', 'z80'];
    if (params.extra_link_args)
      args.push.apply(args, params.extra_link_args);
    args.push.apply(args, step.args);
    execMain(step, LDZ80, args);
    var hexout = FS.readFile("main.ihx", {encoding:'utf8'});
    var mapout = FS.readFile("main.noi", {encoding:'utf8'});
    putWorkFile("main.ihx", hexout);
    putWorkFile("main.noi", mapout);
    // return unchanged if no files changed
    if (!anyTargetChanged(step, ["main.ihx", "main.noi"]))
      return;
      
    var listings = {};
    for (var fn of step.files) {
      if (fn.endsWith('.lst')) {
        var rstout = FS.readFile(fn.replace('.lst','.rst'), {encoding:'utf8'});
        //   0000 21 02 00      [10]   52 	ld	hl, #2
        var asmlines = parseListing(rstout, /^\s*([0-9A-F]+)\s+([0-9A-F][0-9A-F r]*[0-9A-F])\s+\[([0-9 ]+)\]\s+(\d+) (.*)/i, 4, 1, 2);
        var srclines = parseSourceLines(rstout, /^\s+\d+ ;<stdin>:(\d+):/i, /^\s*([0-9A-F]{4})/i);
        putWorkFile(fn, rstout);
        listings[fn] = {
          asmlines:srclines.length ? asmlines : null,
          lines:srclines.length ? srclines : asmlines,
          text:rstout
        };
      }
    }
    // parse symbol map
    var symbolmap = {};
    for (var s of mapout.split("\n")) {
      var toks = s.split(" ");
      if (toks[0] == 'DEF' && !toks[1].startsWith("A$main$")) {
        symbolmap[toks[1]] = parseInt(toks[2], 16);
      }
    }
    return {
      output:parseIHX(hexout, params.rom_start?params.rom_start:params.code_start, params.rom_size),
      listings:listings,
      errors:errors,
      symbolmap:symbolmap,
    };
  }
}

var sdcc;
function compileSDCC(step) {

  gatherFiles(step, {
    mainFilePath:"main.c" // not used
  });
  var outpath = step.prefix + ".asm";
  if (staleFiles(step, [outpath])) {
    var errors = [];
    var params = step.params;
    loadNative('sdcc');
    var SDCC = sdcc({
      instantiateWasm: moduleInstFn('sdcc'),
      noInitialRun:true,
      noFSInit:true,
      print:print_fn,
      printErr:msvcErrorMatcher(errors),
      //TOTAL_MEMORY:256*1024*1024,
    });
    var FS = SDCC['FS'];
    populateFiles(step, FS);
    // load source file and preprocess
    var code = workfs[step.path].data; // TODO
    var preproc = preprocessMCPP(step);
    if (preproc.errors) return preproc;
    else code = preproc.code;
    // pipe file to stdin
    setupStdin(FS, code);
    setupFS(FS, 'sdcc');
    var args = ['--vc', '--std-sdcc99', '-mz80', //'-Wall',
      '--c1mode', // '--debug',
      //'-S', 'main.c',
      //'--asm=sdasz80',
      //'--reserve-regs-iy',
      '--less-pedantic',
      ///'--fomit-frame-pointer',
      '--opt-code-speed',
      //'--oldralloc', // TODO: does this make it fater?
      //'--cyclomatic',
      //'--nooverlay','--nogcse','--nolabelopt','--noinvariant','--noinduction','--nojtbound','--noloopreverse','--no-peep','--nolospre',
      '-o', outpath];
    if (params.extra_compile_args) {
      args.push.apply(args, params.extra_compile_args);
    }
    execMain(step, SDCC, args);
    // TODO: preprocessor errors w/ correct file
    if (errors.length /* && nwarnings < msvc_errors.length*/) {
      return {errors:errors};
    }
    // massage the asm output
    var asmout = FS.readFile(outpath, {encoding:'utf8'});
    asmout = " .area _HOME\n .area _CODE\n .area _INITIALIZER\n .area _DATA\n .area _INITIALIZED\n .area _BSEG\n .area _BSS\n .area _HEAP\n" + asmout;
    putWorkFile(outpath, asmout);
  }
  return {
    nexttool:"sdasz80",
    path:outpath,
    args:[outpath]
  };
}

function preprocessMCPP(step) {
  load("mcpp");
  var platform = step.platform;
  var params = PLATFORM_PARAMS[platform];
  if (!params) throw Error("Platform not supported: " + platform);
  // <stdin>:2: error: Can't open include file "foo.h"
  var errors = [];
  var match_fn = makeErrorMatcher(errors, /<stdin>:(\d+): (.+)/, 1, 2, step.path);
  var MCPP = mcpp({
    noInitialRun:true,
    noFSInit:true,
    print:print_fn,
    printErr:match_fn,
  });
  var FS = MCPP['FS'];
  setupFS(FS, 'sdcc'); // TODO: toolname
  populateFiles(step, FS);
  // TODO: make configurable by other compilers
  var args = [
    "-D", "__8BITWORKSHOP__",
    "-D", platform.toUpperCase().replace('-','_'),
    "-D", "__SDCC_z80",
    "-I", "/share/include",
    "-Q",
    step.path, "main.i"];
  if (params.extra_preproc_args) {
    args.push.apply(args, params.extra_preproc_args);
  }
  MCPP.callMain(args);
  if (errors.length)
    return {errors:errors};
  var iout = FS.readFile("main.i", {encoding:'utf8'});
  iout = iout.replace(/^#line /gm,'\n# ');
  try {
    var errout = FS.readFile("mcpp.err", {encoding:'utf8'});
    if (errout.length) {
      // //main.c:2: error: Can't open include file "stdiosd.h"
      var errors = extractErrors(/[^:]+:(\d+): (.+)/, errout.split("\n"), step.path);
      if (errors.length == 0) {
        errors = [{line:0, msg:errout}];
      }
      return {errors: errors};
    }
  } catch (e) {
    //
  }
  return {code:iout};
}

// TODO: must be a better way to do all this

function detectModuleName(code) {
  var m = /\bmodule\s+(\w+_top)\b/.exec(code)
       || /\bmodule\s+(top)\b/.exec(code)
       || /\bmodule\s+(\w+)\b/.exec(code);
  return m ? m[1] : null;
}

function detectTopModuleName(code) {
  var topmod = detectModuleName(code) || "top";
  var m = /\bmodule\s+(\w+?_top)/.exec(code);
  if (m && m[1]) topmod = m[1];
  return topmod;
}

function writeDependencies(depends, FS, errors, callback) {
  if (depends) {
    for (var i=0; i<depends.length; i++) {
      var d = depends[i];
      var text = d.data;
      if (callback)
        text = callback(d, text);
      if (text && FS)
        FS.writeFile(d.filename, text, {encoding:'utf8'});
    }
  }
}

var jsasm_module_top;
var jsasm_module_output;
var jsasm_module_key;

function compileJSASM(asmcode, platform, options, is_inline) {
  loadGen("worker/assembler");
  var asm = new Assembler();
  var includes = [];
  asm.loadJSON = function(filename) {
    // TODO: what if it comes from dependencies?
    var path = '../../presets/' + platform + '/' + filename;
    var xhr = new XMLHttpRequest();
    xhr.responseType = 'json';
    xhr.open("GET", path, false);  // synchronous request
    xhr.send(null);
    return xhr.response;
  };
  asm.loadInclude = function(filename) {
    if (!filename.startsWith('"') || !filename.endsWith('"'))
      return 'Expected filename in "double quotes"';
    filename = filename.substr(1, filename.length-2);
    includes.push(filename);
  };
  var loaded_module = false;
  asm.loadModule = function(top_module) {
    // TODO: cache module
    // compile last file in list
    loaded_module = true;
    var key = top_module + '/' + includes;
    if (key != jsasm_module_key) {
      jsasm_module_key = key;
      jsasm_module_top = top_module;
      var main_filename = includes[includes.length-1];
      var code = '`include "' + main_filename + '"\n';
      code += "/* module " + top_module + " */\n";
      var voutput = compileVerilator({code:code, platform:platform, dependencies:options.dependencies, path:options.path}); // TODO
      if (voutput.errors.length)
        return voutput.errors[0].msg;
      jsasm_module_output = voutput;
    }
  }
  var result = asm.assembleFile(asmcode);
  if (loaded_module && jsasm_module_output) {
    var asmout = result.output;
    // TODO: unify
    result.output = jsasm_module_output.output;
    result.output.program_rom = asmout;
    // cpu_platform__DOT__program_rom
    result.output.program_rom_variable = jsasm_module_top + "__DOT__program_rom";
    result.listings = {};
    result.listings[options.path] = {lines:result.lines};
  }
  return result;
}

function compileJSASMStep(step) {
  // TODO
  var code = step.code;
  var platform = step.platform || 'verilog';
  return compileJSASM(code, platform, step); // TODO
}

function compileInlineASM(code, platform, options, errors, asmlines) {
  code = code.replace(/__asm\b([\s\S]+?)\b__endasm\b/g, function(s,asmcode,index) {
    var firstline = code.substr(0,index).match(/\n/g).length;
    var asmout = compileJSASM(asmcode, platform, options, true);
    if (asmout.errors && asmout.errors.length) {
      for (var i=0; i<asmout.errors.length; i++) {
        asmout.errors[i].line += firstline;
        errors.push(asmout.errors[i]);
      }
      return "";
    } else if (asmout.output) {
      var s = "";
      var out = asmout.output;
      for (var i=0; i<out.length; i++) {
        if (i>0) s += ",";
        s += 0|out[i];
      }
      if (asmlines) {
        var al = asmout.lines;
        for (var i=0; i<al.length; i++) {
          al[i].line += firstline;
          asmlines.push(al[i]);
        }
      }
      return s;
    }
  });
  return code;
}

// TODO: make compliant with standard msg format
function compileVerilator(step) {
  loadNative("verilator_bin");
  loadGen("worker/verilator2js");
  var platform = step.platform || 'verilog';
  var errors = [];
  var asmlines = [];
  step.code = compileInlineASM(step.code, platform, step, errors, asmlines);
  var code = step.code;
  var match_fn = makeErrorMatcher(errors, /%(.+?): (.+?:)?(\d+)?[:]?\s*(.+)/i, 3, 4);
  var verilator_mod = verilator_bin({
    instantiateWasm: moduleInstFn('verilator_bin'),
    noInitialRun:true,
    print:print_fn,
    printErr:match_fn,
    TOTAL_MEMORY:256*1024*1024,
  });
  var topmod = detectTopModuleName(code);
  var FS = verilator_mod['FS'];
  populateFiles(step, FS, {mainFilePath:step.path});
  writeDependencies(step.dependencies, FS, errors, function(d, code) {
    return compileInlineASM(code, platform, step, errors, null);
  });
  starttime();
  try {
    var args = ["--cc", "-O3", "-DEXT_INLINE_ASM", "-DTOPMOD__"+topmod,
      "-Wall", "-Wno-DECLFILENAME", "-Wno-UNUSED", '--report-unoptflat',
      "--x-assign", "fast", "--noassert", "--pins-bv", "33",
      "--top-module", topmod, step.path]
    verilator_mod.callMain(args);
  } catch (e) {
    console.log(e);
    errors.push({line:0,msg:"Compiler internal error: " + e});
  }
  endtime("compile");
  // remove boring errors
  errors = errors.filter(function(e) { return !/Exiting due to \d+/.exec(e.msg); }, errors);
  errors = errors.filter(function(e) { return !/Use ["][/][*]/.exec(e.msg); }, errors);
  if (errors.length) {
    return {errors:errors};
  }
  try {
    var h_file = FS.readFile("obj_dir/V"+topmod+".h", {encoding:'utf8'});
    var cpp_file = FS.readFile("obj_dir/V"+topmod+".cpp", {encoding:'utf8'});
    var rtn = translateVerilatorOutputToJS(h_file, cpp_file);
    putWorkFile("main.js", rtn.output.code);
    if (!anyTargetChanged(step, ["main.js"]))
      return;
    rtn.errors = errors;
    rtn.intermediate = {listing:h_file + cpp_file}; // TODO
    rtn.listings = {};
    // TODO: what if found in non-top-module?
    if (asmlines.length)
      rtn.listings[step.path] = {lines:asmlines};
    return rtn;
  } catch(e) {
    console.log(e);
    return {errors:errors};
  }
}

// TODO: test
function compileYosys(step) {
  loadNative("yosys");
  var code = step.code;
  var errors = [];
  var match_fn = makeErrorMatcher(errors, /ERROR: (.+?) in line (.+?[.]v):(\d+)[: ]+(.+)/i, 3, 4);
  starttime();
  var yosys_mod = yosys({
    instantiateWasm: moduleInstFn('yosys'),
    noInitialRun:true,
    print:print_fn,
    printErr:match_fn,
  });
  endtime("create module");
  var topmod = detectTopModuleName(code);
  var FS = yosys_mod['FS'];
  FS.writeFile(topmod+".v", code);
  writeDependencies(step.dependencies, FS, errors);
  starttime();
  try {
    yosys_mod.callMain(["-q", "-o", topmod+".json", "-S", topmod+".v"]);
  } catch (e) {
    console.log(e);
    endtime("compile");
    return {errors:errors};
  }
  endtime("compile");
  //TODO: filename in errors
  if (errors.length) return {errors:errors};
  try {
    var json_file = FS.readFile(topmod+".json", {encoding:'utf8'});
    var json = JSON.parse(json_file);
    console.log(json);
    return {yosys_json:json, errors:errors}; // TODO
  } catch(e) {
    console.log(e);
    return {errors:errors};
  }
}

var TOOLS = {
  'dasm': assembleDASM,

  //'acme': assembleACME,
  //'plasm': compilePLASMA,
  'cc65': compileCC65,
  'ca65': assembleCA65,
  'ld65': linkLD65,
  //'z80asm': assembleZ80ASM,
  //'sccz80': compileSCCZ80,
  'sdasz80': assembleSDASZ80,
  'sdldz80': linkSDLDZ80,
  'sdcc': compileSDCC,
  //'xasm6809': assembleXASM6809,
  //'naken': assembleNAKEN,
  'verilator': compileVerilator,
  'yosys': compileYosys,
  //'caspr': compileCASPR,
  'jsasm': compileJSASMStep,
}

var TOOL_PRELOADFS = {
  'cc65-apple2': '65-apple2',
  'ca65-apple2': '65-apple2',
  'cc65-c64': '65-c64',
  'ca65-c64': '65-c64',
  'cc65-nes': '65-nes',
  'ca65-nes': '65-nes',
  'cc65-atari8': '65-atari8',
  'ca65-atari8': '65-atari8',
  'sdasz80': 'sdcc',
  'sdcc': 'sdcc',
  'sccz80': 'sccz80',
}

function applyDefaultErrorPath(errors, path) {
  if (!path) return;
  for (var i=0; i<errors.length; i++) {
    var err = errors[i];
    if (!err.path && err.line) err.path = path;
  }
}

function executeBuildSteps() {
  buildstartseq = workerseq;
  while (buildsteps.length) {
    var step = buildsteps.shift(); // get top of array
    var code = step.code;
    var platform = step.platform;
    var toolfn = TOOLS[step.tool];
    if (!toolfn) throw "no tool named " + step.tool;
    step.params = PLATFORM_PARAMS[platform];
    console.log(step.platform + " " + step.tool);
    try {
      step.result = toolfn(step);
    } catch (e) {
      console.log("EXCEPTION", e.stack);
      return {errors:[{line:0, msg:e+""}]}; // TODO: catch errors already generated?
    }
    if (step.result) {
      // errors? return them
      if (step.result.errors) {
        applyDefaultErrorPath(step.result.errors, step.path);
        return step.result;
      }
      // if we got some output, return it immediately
      if (step.result.output) {
        return step.result;
      }
      // combine files with a link tool?
      if (step.result.linktool) {
        var linkstep = {
          tool:step.result.linktool,
          platform:platform,
          files:step.result.files,
          args:step.result.args
        };
        step.generated = linkstep.files;
        // find previous link step to combine
        for (var i=0; i<buildsteps.length; i++) {
          var ls = buildsteps[i];
          if (ls.tool == linkstep.tool && ls.platform == linkstep.platform && ls.files) {
            ls.files = ls.files.concat(linkstep.files);
            ls.args = ls.args.concat(linkstep.args);
            linkstep = null;
            break;
          }
        }
        if (linkstep) buildsteps.push(linkstep);
      }
      // process with another tool?
      if (step.result.nexttool) {
        var asmstep = {
          tool:step.result.nexttool,
          platform:platform,
          files:[step.result.path],
          path:step.result.path,
          args:step.result.args
        };
        buildsteps.push(asmstep);
        step.generated = asmstep.files;
      }
    }
  }
}

function handleMessage(data) {
  // preload file system
  if (data.preload) {
    var fs = TOOL_PRELOADFS[data.preload];
    if (!fs && data.platform)
      fs = TOOL_PRELOADFS[data.preload+'-'+data.platform.split('-')[0]];
    if (fs && !fsMeta[fs])
      loadFilesystem(fs);
    return;
  }
  // clear filesystem? (TODO: buildkey)
  if (data.reset) {
    workfs = {};
    return;
  }
  // (code,platform,tool,dependencies)
  buildsteps = [];
  // file updates
  if (data.updates) {
    for (var i=0; i<data.updates.length; i++) {
      var u = data.updates[i];
      putWorkFile(u.path, u.data);
    }
  }
  // build steps
  if (data.buildsteps) {
    buildsteps.push.apply(buildsteps, data.buildsteps);
  }
  // single-file
  if (data.code) {
    buildsteps.push(data);
  }
  // execute build steps
  if (buildsteps.length) {
    var result = executeBuildSteps();
    return result ? result : {unchanged:true};
  }
  // TODO: cache results
  // message not recognized
  console.log("Unknown message",data);
}

if (ENVIRONMENT_IS_WORKER) {
  onmessage = function(e) {
    var result = handleMessage(e.data);
    if (result) {
      postMessage(result);
    }
  }
}
