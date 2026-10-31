import { NEWS } from '../data'

export function NewsPage() {
  return (
    <section className="content">
      {NEWS.map((item) => (
        <article key={item.id} className="news-card">
          <h3>{item.title}</h3>
          <p>{item.summary}</p>
          <div className="news-meta">
            <span>{item.date}</span>
            <span>{item.source}</span>
          </div>
        </article>
      ))}
    </section>
  )
}
