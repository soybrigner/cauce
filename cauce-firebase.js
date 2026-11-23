/* Cauce · conexión con Firebase (solo la versión web).
   Pone a Firebase detrás de la misma interfaz que la app ya usa (window.claude: user, db y downloads), así el resto de Cauce no cambia.
   Si firebase-config.js está vacío no hace nada y Cauce queda solo en el dispositivo. */
(function () {
  'use strict';
  var cfg = window.CAUCE_FIREBASE;
  if (!cfg || !cfg.apiKey || !cfg.projectId || window.claude) return;

  var VER = '10.14.1', BASE = 'https://www.gstatic.com/firebasejs/' + VER + '/firebase-';
  // Huella de cada librería: si alguien cambiara el archivo en el camino, el navegador se niega a ejecutarlo y Cauce sigue funcionando solo en el dispositivo.
  var SRI = {
    'app-compat.js': 'sha384-ZaR6mWzmJtrRibZ1Vm7SoHFr8OXjyAuGAXalGDKqbxFT18oi/z+oZLIRFkpeNor1',
    'auth-compat.js': 'sha384-I1LYojsZ5RM1cOda44Z2h42Qa6YfsQ1XkXxREnhp4ueYBR/4d1pG1K+NZM537Vsj',
    'firestore-compat.js': 'sha384-Ke0FJhH7LyRqDxZ0wt+/OXV38yfQVu7g9VPEEGjYmB4RVOY/ta04uecRhsMwT7V3'
  };
  var auth = null, fs = null, user = null, state = 'loading', listeners = [], first = true, initP = null;

  function load(name) {
    var src = BASE + name;
    return new Promise(function (ok, no) {
      var s = document.createElement('script'), t = setTimeout(function () { s.remove(); no(new Error('timeout')); }, 15000);
      s.src = src; s.async = true; s.integrity = SRI[name]; s.crossOrigin = 'anonymous';
      s.onload = function () { clearTimeout(t); ok(); };
      s.onerror = function () { clearTimeout(t); s.remove(); no(new Error('load')); };
      document.head.appendChild(s);
    });
  }
  function cu() { return (auth && auth.currentUser) || null; }       // quién tiene la sesión ahora (Firebase lo actualiza al terminar de entrar o salir)
  function notify() { listeners.slice().forEach(function (fn) { try { fn(user); } catch (e) { /* nada */ } }); }

  // Carga las librerías de Firebase y espera a saber si hay una sesión abierta. Si no se pudo (sin internet y sin copia guardada), se puede reintentar.
  function init() {
    if (initP && state !== 'unavailable') return initP;
    state = 'loading';
    initP = (async function () {
      try {
        if (!window.firebase) { await load('app-compat.js'); await Promise.all([load('auth-compat.js'), load('firestore-compat.js')]); }
        var fb = window.firebase;
        if (!fb.apps.length) fb.initializeApp(cfg);
        auth = fb.auth(); fs = fb.firestore();
        try { if (auth.useDeviceLanguage) auth.useDeviceLanguage(); } catch (e) { /* los correos salen en el idioma del teléfono; si no se puede, en el de Firebase */ }
        try { fs.settings({ ignoreUndefinedProperties: true }); } catch (e) { /* ya estaba en uso */ }
        if (first) {
          await new Promise(function (res) {
            auth.onAuthStateChanged(function (u) {
              user = u || null; state = u ? 'in' : 'out';
              if (first) { first = false; res(); } else notify();
            });
          });
        } else state = user ? 'in' : 'out';
        return true;
      } catch (e) { state = 'unavailable'; return false; }
    })();
    return initP;
  }
  function need() {
    return init().then(function (ok) { if (!ok) { var e = new Error('sin conexión'); e.code = 'auth/network-request-failed'; throw e; } return true; });
  }

  // La app guarda en «data/users/<id>» (y las fotos en «…/rcp/p»); en Firebase eso vive en «users/<id>/cauce» y «users/<id>/cauce-fotos»,
  // para que una sola regla («cada quien lee y escribe solo lo suyo») cubra todo.
  function mapPath(p) {
    var m = /^data\/users\/([^\/]+)(\/rcp\/p)?$/.exec(p);
    if (!m) throw new Error('ruta no permitida: ' + p);
    return 'users/' + m[1] + (m[2] ? '/cauce-fotos' : '/cauce');
  }
  function clean(o) { return JSON.parse(JSON.stringify(o)); }                 // quita undefined, que Firestore no acepta
  function fail(e) {
    var c = e && e.code ? String(e.code).replace(/^firestore\//, '') : '', x = new Error((e && e.message) || c || 'error');
    x.code = c === 'resource-exhausted' ? 'quota_exceeded' : c; throw x;
  }
  function snap(d) { return { id: d.id, exists: !!d.exists, data: function () { return d.data(); } }; }

  var db = {
    collection: function (path) {
      var ref = fs.collection(mapPath(path));
      return {
        get: function () { return ref.get().then(function (q) { return { docs: q.docs.map(snap) }; }, fail); },
        doc: function (id) {
          var dr = ref.doc(id);
          return {
            set: function (d) { return dr.set(clean(d)).then(function () { return true; }, fail); },
            delete: function () { return dr.delete().then(function () { return true; }, fail); },
            get: function () { return dr.get().then(snap, fail); }
          };
        }
      };
    }
  };
  var userApi = {
    id: function () { return init().then(function () { var u = cu(); return u ? u.uid : null; }); },
    me: function () { return init().then(function () { var u = cu(); return u ? { email: u.email || '', name: u.displayName || '' } : null; }); }
  };
  var downloads = {
    save: function (o) {
      return new Promise(function (ok, no) {
        try {
          var blob = new Blob([o.data], { type: /\.csv$/.test(o.filename) ? 'text/csv;charset=utf-8' : 'application/json' }), a = document.createElement('a');
          a.href = URL.createObjectURL(blob); a.download = o.filename; document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); ok(true);
        } catch (e) { no(e); }
      });
    }
  };
  window.claude = {
    web: true,
    use: function (name) {
      if (name === 'user') return init().then(function () { return userApi; });
      if (name === 'db') return need().then(function () { return db; });
      if (name === 'downloads') return Promise.resolve(downloads);
      return Promise.resolve(null);
    }
  };

  // Borra todos los documentos de una colección del usuario, de a lotes (Firestore permite hasta 500 por lote).
  function wipeCol(path) {
    return fs.collection(path).get().then(function (q) {
      var docs = q.docs.slice(), jobs = [];
      for (var i = 0; i < docs.length; i += 400) {
        var b = fs.batch(); docs.slice(i, i + 400).forEach(function (d) { b.delete(d.ref); }); jobs.push(b.commit());
      }
      return Promise.all(jobs);
    });
  }
  // Por seguridad, cambiar la contraseña y borrar la cuenta piden la contraseña actual otra vez.
  function reauth(pw) {
    var u = cu(); if (!u) { var e = new Error('sin sesión'); e.code = 'auth/requires-recent-login'; return Promise.reject(e); }
    return u.reauthenticateWithCredential(window.firebase.auth.EmailAuthProvider.credential(u.email, pw)).then(function () { return u; });
  }
  function pub() { var u = cu(); return u ? { uid: u.uid, email: u.email || '', verified: !!u.emailVerified } : null; }

  window.CauceAuth = {
    ready: function () { return init(); },
    state: function () { return state; },
    user: pub,
    signIn: function (email, pw) { return need().then(function () { return auth.signInWithEmailAndPassword(email, pw); }).then(function () { return true; }); },
    signUp: function (email, pw) {
      return need().then(function () { return auth.createUserWithEmailAndPassword(email, pw); })
        .then(function (c) { try { var r = c && c.user && c.user.sendEmailVerification(); if (r && r.catch) r.catch(function () { /* el correo de verificación es un extra: si falla, la cuenta igual queda creada */ }); } catch (e) { /* idem */ } return true; });
    },
    signOut: function () { return need().then(function () { return auth.signOut(); }).then(function () { return true; }); },
    reset: function (email) { return need().then(function () { return auth.sendPasswordResetEmail(email); }).then(function () { return true; }); },
    resendVerification: function () { return need().then(function () { var u = cu(); if (!u) throw new Error('sin sesión'); return u.sendEmailVerification(); }).then(function () { return true; }); },
    refresh: function () { return need().then(function () { var u = cu(); return u ? u.reload() : null; }).then(pub); },
    changePassword: function (oldPw, newPw) { return need().then(function () { return reauth(oldPw); }).then(function (u) { return u.updatePassword(newPw); }).then(function () { return true; }); },
    // Primero se borran los datos (mientras la sesión sirve), después la cuenta. Si algo falla antes de borrar la cuenta, se puede reintentar.
    deleteAccount: function (pw) {
      return need().then(function () { return reauth(pw); }).then(function (u) {
        return Promise.all([wipeCol('users/' + u.uid + '/cauce'), wipeCol('users/' + u.uid + '/cauce-fotos')]).then(function () { return u.delete(); });
      }).then(function () { return true; });
    },
    onChange: function (fn) { listeners.push(fn); }
  };
  init();
})();
