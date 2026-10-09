"""Merges the docs Sonnet extracted for the graph into graphify-out/graph.json, with no model.

Run with graphify's own Python: graph_docs.py <project root> [extraction spec path].
Reads graphify-out/.graphify_chunk_*.json (one per batch the band sent to Sonnet), then caches,
merges, clusters, reports and exports the way the graphify skill's --update does, and deletes the chunks.
"""
import json
import sys
from collections import Counter
from pathlib import Path

from graphify.analyze import god_nodes, suggest_questions, surprising_connections
from graphify.build import build_merge
from graphify.cache import save_semantic_cache
from graphify.cluster import cluster, score_all
from graphify.detect import detect
from graphify.export import to_html, to_json
from graphify.report import generate

root = Path(sys.argv[1]).resolve()
spec = sys.argv[2] if len(sys.argv) > 2 and Path(sys.argv[2]).exists() else None
out = root / 'graphify-out'
chunks = sorted(out.glob('.graphify_chunk_*.json'))


def rel(path):
    # The graph keeps paths relative to the root; the same file under two spellings would be minted twice.
    p = Path(path)
    try:
        return (p if p.is_absolute() else root / p).resolve().relative_to(root).as_posix()
    except ValueError:
        return str(path)


new = {'nodes': [], 'edges': [], 'hyperedges': []}
for chunk in chunks:
    data = json.loads(chunk.read_text(encoding='utf-8'))
    for key in new:
        for item in data.get(key) or []:
            if item.get('source_file'):
                item['source_file'] = rel(item['source_file'])
            new[key].append(item)
if not new['nodes']:
    sys.exit('No nodes in the docs Sonnet extracted.')

sources = sorted({n['source_file'] for n in new['nodes']})
save_semantic_cache(new['nodes'], new['edges'], new['hyperedges'], root=root, allowed_source_files=[root / s for s in sources], prompt_file=spec)

graph_path = out / 'graph.json'
old_names = {n['id']: n.get('community_name') for n in json.loads(graph_path.read_text(encoding='utf-8')).get('nodes', [])} if graph_path.exists() else {}
G = build_merge([{**new, 'input_tokens': 0, 'output_tokens': 0}], graph_path=graph_path, root=root, directed=False)
if G.number_of_nodes() == 0:
    sys.exit('The merged graph is empty.')

communities = cluster(G)
cohesion = score_all(G, communities)
# Each community keeps the name most of its nodes had before; a new one gets a placeholder.
labels = {}
for cid, members in communities.items():
    names = Counter(old_names[n] for n in members if old_names.get(n))
    labels[cid] = names.most_common(1)[0][0] if names else f'Community {cid}'
gods = god_nodes(G)
surprises = surprising_connections(G, communities)
questions = suggest_questions(G, communities, labels)
# Re-extracted docs can come back with fewer nodes than before; that shrink is expected here.
to_json(G, communities, str(graph_path), community_labels=labels, force=True)
report = generate(G, communities, cohesion, labels, gods, surprises, detect(root), {'input': 0, 'output': 0}, str(root), suggested_questions=questions)
(out / 'GRAPH_REPORT.md').write_text(report, encoding='utf-8')
(out / '.graphify_labels.json').write_text(json.dumps({str(k): v for k, v in labels.items()}, ensure_ascii=False), encoding='utf-8')
to_html(G, communities, str(out / 'graph.html'), community_labels=labels)
for chunk in chunks:
    chunk.unlink()
print(f'{G.number_of_nodes()} nodes, {G.number_of_edges()} edges, {len(communities)} communities; {len(sources)} docs merged')
