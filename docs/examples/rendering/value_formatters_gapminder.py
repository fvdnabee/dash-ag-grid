import dash_ag_grid as dag
from dash import Dash, html, dcc
import plotly.express as px

df = px.data.gapminder()

app = Dash(__name__)

columnDefs = [
    {"headerName": "Country", "field": "country"},
    {"headerName": "Continent", "field": "continent"},
    {"headerName": "Year", "field": "year"},
    {
        "headerName": "Life Expectancy",
        "field": "lifeExp",
        "type": "rightAligned",
        "valueFormatter": {"function": "d3.format('.1f')(params.value)"},
    },
    {
        "headerName": "Population",
        "field": "pop",
        "type": "rightAligned",
        "valueFormatter": {"function": "d3.format(',.0f')(params.value)"},
    },
    {
        "headerName": "GDP per Capita",
        "field": "gdpPercap",
        "type": "rightAligned",
        "valueFormatter": {"function": "d3.format('$,.1f')(params.value)"},
    },
]

app.layout = html.Div(
    [
        dcc.Markdown("Gapminder Data with formatting"),
        dag.AgGrid(
            columnDefs=columnDefs,
            defaultColDef="",
            rowData=df.to_dict("records"),
            columnSize="sizeToFit",
        ),
        dcc.Markdown("Gapminder Data without formatting", style={"marginTop": 40}),
        dag.AgGrid(
            columnDefs=[{"field": i} for i in df.columns],
            rowData=df.to_dict("records"),
            columnSize="sizeToFit",
        ),
    ],
    style={"margin": 20},
)

if __name__ == "__main__":
    app.run(debug=True)
