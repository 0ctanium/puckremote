import * as React from 'react';
import { renderToString } from 'react-dom/server.browser';
globalThis.__renderTest = (name) => renderToString(<section className="x"><h1>Hello {name}</h1><p>{[1,2,3].map(i => <b key={i}>{i}</b>)}</p></section>);
