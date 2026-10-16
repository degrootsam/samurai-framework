/**
 * The toolbar's styles, scoped to its shadow root: the rail, the collapsed chip, the panels, the picker
 * outline and the toast, as in the approved mockups. Everything inside is `position: fixed` against the
 * viewport; the host itself takes no space.
 */
export const TOOLBAR_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.ui { font: 12px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; color: #222; color-scheme: light; }
button, input, select { font: inherit; color: inherit; margin: 0; }
button { appearance: none; background: none; border: 0; padding: 0; cursor: pointer; text-align: left; }
button:disabled { cursor: default; }
code { font: 11.5px ui-monospace, SFMono-Regular, Menlo, monospace; }

.rail, .chip { position: fixed; z-index: 3; box-shadow: 0 6px 20px rgba(0,0,0,.28); background: #17181c; color: #e9eaee; user-select: none; }
.rail { display: flex; flex-direction: column; gap: 2px; border-radius: 10px; padding: 5px; width: 112px; }
.rail.wide { width: 150px; }
.top { display: flex; align-items: center; justify-content: space-between; color: #6b6e78; padding: 0 2px 2px; }
[data-grip] { cursor: grab; flex: 1; touch-action: none; }
[data-grip]:active { cursor: grabbing; }
.chev { color: #6b6e78; padding: 0 3px; border-radius: 4px; }
.chev:hover { color: #e9eaee; }
.st { display: flex; align-items: center; gap: 6px; padding: 4px 6px; font-weight: 600; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #ff4d4f; box-shadow: 0 0 0 3px rgba(255,77,79,.25); flex: none; }
.dot.pause { background: #f5b301; box-shadow: 0 0 0 3px rgba(245,179,1,.25); }
.b { padding: 5px 7px; border-radius: 6px; display: flex; align-items: center; gap: 6px; width: 100%; }
.b:hover:not(:disabled) { background: #2a2c33; }
.b.on, .b.on:hover:not(:disabled) { background: #2f6fed; color: #fff; }
.b:disabled { opacity: .38; }
.sep { height: 1px; background: #34363d; margin: 2px 3px; }
.stop { color: #ff8a8c; }
.ico { width: 14px; text-align: center; flex: none; }
.note { font-size: 10.5px; color: #c9cbd2; padding: 4px 6px 2px; line-height: 1.35; }
.ask { display: flex; gap: 4px; padding: 2px 6px 4px; }
.ask button { flex: 1; text-align: center; border-radius: 5px; padding: 3px 0; background: #2a2c33; }
.ask button.yes { background: #2f6fed; color: #fff; font-weight: 600; }

.chip { display: flex; align-items: center; gap: 7px; border-radius: 999px; padding: 6px 10px 6px 8px; font-weight: 600; }
.chip [data-grip] { color: #6b6e78; flex: none; }
.chip .chev { color: #9a9ca5; }

.panel { position: fixed; z-index: 2; width: 230px; max-height: calc(100vh - 16px); overflow: auto; background: #fff; border: 1px solid #d9dce1; border-radius: 10px; box-shadow: 0 10px 28px rgba(0,0,0,.18); color: #222; }
.panel.wide { width: 236px; }
.h { padding: 8px 10px; border-bottom: 1px solid #eceef1; font-weight: 600; display: flex; justify-content: space-between; gap: 8px; }
.h.stack { display: block; }
.h code { font-size: 11px; color: #555; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.h small { display: block; font-weight: 400; color: #777; margin-top: 2px; }
.msg { padding: 10px; color: #555; }
.err { padding: 6px 10px; color: #c22b2e; }
.opts { padding: 6px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.o { border: 1px solid #e3e5e8; border-radius: 6px; padding: 5px 6px; }
.o:hover:not(:disabled) { border-color: #b9c6e4; }
.o.sel { border-color: #2f6fed; background: #eef3fe; color: #1d4fc4; font-weight: 600; }
.o:disabled { opacity: .45; }
.val { margin: 2px 8px 8px; display: flex; flex-direction: column; gap: 4px; }
.in { width: 100%; border: 1px solid #cfd3d8; border-radius: 4px; padding: 5px 6px; background: #fff; outline: none; }
.in:focus { border-color: #2f6fed; box-shadow: 0 0 0 2px rgba(47,111,237,.15); }
.in.code { font: 11.5px ui-monospace, SFMono-Regular, Menlo, monospace; }
.row { display: flex; justify-content: space-between; align-items: center; padding: 0 8px 8px; }
.neg { color: #555; display: flex; align-items: center; gap: 4px; }
.add { background: #2f6fed; color: #fff; border-radius: 6px; padding: 5px 12px; font-weight: 600; text-align: center; }
.add:disabled { opacity: .5; }
.cancel { padding: 5px 10px; color: #555; }
.foot { display: flex; justify-content: flex-end; gap: 8px; padding: 8px 10px; border-top: 1px solid #eceef1; }
.foot.plain { border-top: 0; padding-top: 10px; }

.search { display: block; margin: 6px 8px; width: calc(100% - 16px); }
.grp { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #888; padding: 6px 10px 2px; }
.it { display: flex; justify-content: space-between; gap: 8px; padding: 5px 10px; width: 100%; }
.it:hover, .it.sel { background: #eef3fe; }
.it .v { color: #777; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.warn { color: #b26a00; }
.empty { padding: 4px 10px; color: #777; }
.act { padding: 6px 10px; color: #1d4fc4; font-weight: 600; width: 100%; }
.act:hover { background: #eef3fe; }

.seg { display: flex; margin: 8px 10px 0; border: 1px solid #cfd3d8; border-radius: 6px; overflow: hidden; }
.seg button { flex: 1; text-align: center; padding: 4px; }
.seg .sel { background: #eef3fe; color: #1d4fc4; font-weight: 600; }
.lbl { font-size: 11px; color: #666; padding: 6px 10px 2px; }
.f { padding: 0 10px; }
.field-error { color: #c22b2e; font-size: 11px; padding: 3px 10px 0; }
.hint { padding: 6px 10px 0; color: #666; font-size: 11px; line-height: 1.35; }
.hint code { font-size: 10.5px; }

.radio { padding: 6px 10px; display: flex; gap: 7px; align-items: center; }
.radio input[type=radio] { accent-color: #2f6fed; margin: 0; }
.sub { color: #777; font-size: 11px; padding: 0 10px 2px 30px; margin-top: -4px; }
.num { width: 52px; border: 1px solid #cfd3d8; border-radius: 4px; padding: 3px 5px; }

.outline { position: fixed; z-index: 1; pointer-events: none; outline: 2px solid #2f6fed; outline-offset: 2px; border-radius: 4px; background: rgba(47,111,237,.06); }
.toast { position: fixed; z-index: 4; left: 50%; bottom: 14px; transform: translateX(-50%); background: #17181c; color: #e9eaee; border-radius: 8px; padding: 6px 12px; box-shadow: 0 6px 20px rgba(0,0,0,.28); pointer-events: none; transition: opacity .3s; }
.toast.gone { opacity: 0; }
.notices {
  position: fixed;
  z-index: 4;
  left: 50%;
  bottom: 52px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: min(520px, calc(100vw - 32px));
}
.notice {
  display: flex;
  gap: 10px;
  align-items: center;
  background: #17181c;
  color: #e9eaee;
  border-radius: 8px;
  padding: 8px 12px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
}
.notice.warning {
  background: #3b2a06;
  color: #ffe7b0;
  border: 1px solid #8a6514;
}
.notice .dismiss {
  margin-left: auto;
  text-decoration: underline;
  white-space: nowrap;
}
.frame { position: fixed; inset: 0; pointer-events: none; visibility: hidden; }
`;
