// Compile-time checks for the typed host data source queries (run by `tsc -p .`).
import { find, findByID, global, source, defineRoot, type QueryResult, type QuerySpec, type RootPropsOf } from '@puck-remote/sdk'
import type { Author, MockCms, Post } from '@puck-remote/source-mock'

type ResultOf<Q> = Q extends QuerySpec<infer T> ? T : never
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
const assert = <T extends true>() => {}
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

// Registered source: collection names and result types are inferred.
const posts = find('posts', { select: ['title', 'slug'] })
assert<Eq<ResultOf<typeof posts>['docs'][number], Pick<Post, 'id' | 'title' | 'slug'>>>()
const allFields = find('posts')
assert<Eq<ResultOf<typeof allFields>['docs'][number], Post>>()
const author = findByID('authors', { $prop: 'authorId' })
assert<Eq<ResultOf<typeof author>, Author | null>>()
const site = global('site')
assert<Eq<ResultOf<typeof site>, { tagline: string; footer: string }>>()

// Explicit source type, no registration needed.
const cms = source<MockCms>()
const a = cms.find('authors', { select: ['name'] })
assert<Eq<ResultOf<typeof a>['docs'][number], Pick<Author, 'id' | 'name'>>>()

// @ts-expect-error unknown collection
find('users')
// @ts-expect-error unknown field in select
find('posts', { select: ['secretNotes'] })
// @ts-expect-error unknown sort key
find('posts', { sort: '-nope' })
// @ts-expect-error unknown global
global('secrets')

// Root render props: the theme's fields plus the app's registered root props.
defineRoot({
  fields: { tone: { type: 'text' } },
  render: (props) => {
    assert<Same<typeof props, { tone: string; title: string; description: string }>>()
    return null
  },
})
assert<Eq<RootPropsOf<{ title: { type: 'text' } }>, { title: string }>>()

export type _ = QueryResult<unknown>
